import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();

declare global {
  interface Window {
    nativeCaptureAudit: {
      contexts: string[];
      settings: MediaTrackSettings[];
      blob?: Blob;
      Decoder: typeof AudioContext;
    };
  }
}

function referenceMicrophone() {
  const rate = 48000,
    frames = rate * 8;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    // Quiet and loud harmonic input exposes gates that a loud oscillator hides.
    const amplitude = Math.floor(t * 4) % 2 ? 0.015 : 0.4;
    const sample =
      amplitude * (Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 880 * t));
    bytes.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  mkdirSync('.local', { recursive: true });
  const path = resolve('.local/native-microphone-reference.wav');
  writeFileSync(path, bytes);
  return path;
}

for (const meter of ['silent-sink', 'unsupported'] as const) {
  test(`preserves quiet native microphone input under UI load with ${meter} metering`, async ({
    playwright,
  }, testInfo) => {
    test.setTimeout(90000);
    const browser = await playwright.chromium.launch({
      ...(existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
        ? { channel: 'msedge' }
        : {}),
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${referenceMicrophone()}`,
      ],
    });
    const { db } = await import('@niticket/database');
    try {
      const { fixtures } = await import('../helpers/fixtures');
      const f = await fixtures();
      const ticket = await db.ticket.create({
        data: {
          creatorId: f.student.id,
          departmentId: f.department.id,
          subject: 'ورودی بومی میکروفون',
        },
      });
      const page = await browser.newPage();
      expect(
        (
          await page.request.post('http://localhost:3001/api/auth/sign-in/phone-number', {
            headers: { origin: 'http://localhost:3001' },
            data: { phoneNumber: f.student.phoneNumber, password: f.password },
          })
        ).ok(),
      ).toBe(true);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((meter) => {
        const NativeContext = AudioContext;
        window.nativeCaptureAudit = { contexts: [], settings: [], Decoder: NativeContext };
        const nativeInput = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          // Keep the browser's genuine input/capture implementation and processing.
          const stream = await nativeInput(constraints);
          window.nativeCaptureAudit.settings.push(stream.getAudioTracks()[0].getSettings());
          return stream;
        };
        window.AudioContext =
          meter === 'unsupported'
            ? (class {
                constructor() {
                  throw new Error('Physical output must not be opened');
                }
              } as unknown as typeof AudioContext)
            : class extends NativeContext {
                constructor(options?: AudioContextOptions) {
                  super(options);
                  const sink = (this as AudioContext & { sinkId?: string | { type: string } })
                    .sinkId;
                  window.nativeCaptureAudit.contexts.push(
                    typeof sink === 'object' ? sink.type : String(sink),
                  );
                }
              };
        const create = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          if (blob instanceof Blob && blob.type.startsWith('audio/'))
            window.nativeCaptureAudit.blob = blob;
          return create(blob);
        };
      }, meter);
      await page.goto(`http://localhost:3001/tickets/${ticket.id}`);
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
        await expect(page.getByRole('button', { name: 'پایان ضبط', exact: true })).toBeVisible();
        await expect(page.getByLabel('مدت ضبط')).toHaveText('۰۰:۰۱');
        await page.evaluate(() => {
          const end = performance.now() + 350;
          while (performance.now() < end) {
            /* Simulate a long UI task while native capture continues. */
          }
        });
        await expect(page.getByLabel('مدت ضبط')).toHaveText('۰۰:۰۳');
        await page.getByRole('button', { name: 'پایان ضبط', exact: true }).click();
        await expect(page.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
        const decoded = await page.evaluate(async () => {
          const audit = window.nativeCaptureAudit;
          const options: AudioContextOptions & { sinkId: { type: 'none' } } = {
            sinkId: { type: 'none' },
          };
          const context = new audit.Decoder(options);
          try {
            const audio = await context.decodeAudioData(await audit.blob!.arrayBuffer());
            const samples = audio.getChannelData(0),
              rate = audio.sampleRate;
            let quiet = 0,
              longestQuiet = 0;
            const levels = [];
            for (let i = Math.floor(0.2 * rate); i < samples.length - 0.1 * rate; i++) {
              quiet = Math.abs(samples[i]) < 1 / 32768 ? quiet + 1 : 0;
              longestQuiet = Math.max(longestQuiet, quiet);
            }
            for (let t = 0.2; t < audio.duration - 0.2; t += 0.02) {
              const part = samples.slice(Math.floor(t * rate), Math.floor((t + 0.02) * rate));
              levels.push(
                Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length),
              );
            }
            return {
              duration: audio.duration,
              silenceMilliseconds: (longestQuiet / rate) * 1000,
              minimumRms: Math.min(...levels),
              contexts: audit.contexts,
              settings: audit.settings,
            };
          } finally {
            await context.close();
          }
        });
        await testInfo.attach(`native-input-${meter}-${attempt}`, {
          body: JSON.stringify(decoded),
          contentType: 'application/json',
        });
        expect(decoded.duration).toBeGreaterThan(2.8);
        expect(decoded.silenceMilliseconds).toBeLessThan(5);
        expect(decoded.minimumRms).toBeGreaterThan(0.002);
        expect(decoded.contexts).toEqual(
          meter === 'silent-sink' ? Array(attempt + 1).fill('none') : [],
        );
        for (const settings of decoded.settings) {
          expect(settings.echoCancellation).toBe(false);
          expect(settings.autoGainControl).toBe(false);
          expect(settings.noiseSuppression).toBe(false);
        }
        await page.getByRole('button', { name: 'پخش پیش‌شنوی پیام صوتی', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'مکث پیش‌شنوی پیام صوتی', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'حذف صدای ضبط‌شده', exact: true }).click();
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await db.$disconnect();
    }
  });
}
