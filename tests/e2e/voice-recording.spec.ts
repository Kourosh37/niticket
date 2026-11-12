import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import type { Prisma } from '@prisma/client';

try {
  loadEnvFile('.env');
} catch {
  /* CI supplies the environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();

test('keeps the microphone stop control in place, displays a live timer and preserves audio at the beginning, middle and end', async ({
  page,
}, testInfo) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'ضبط پایدار' },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    const OriginalRecorder = MediaRecorder;
    window.MediaRecorder = class extends OriginalRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        const events: { type: string; at: number }[] = [];
        (window as unknown as { voiceEvents: typeof events }).voiceEvents = events;
        for (const type of ['start', 'pause', 'resume', 'stop'])
          this.addEventListener(type, () => events.push({ type, at: performance.now() }));
      }
    };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type.startsWith('audio/'))
        (window as unknown as { recordedVoice: Blob }).recordedVoice = blob;
      return url;
    };
    // A continuous reference tone lets decoding verify all three parts of the recording.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const tone = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      tone.connect(destination);
      tone.start();
      return destination.stream;
    };
  });
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.locator('.messenger-timeline-loading')).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const mic = page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true });
    const before = (await mic.boundingBox())!;
    await mic.click();
    const stop = page.getByRole('button', { name: 'پایان ضبط', exact: true });
    await expect(stop).toBeVisible();
    const after = (await stop.boundingBox())!;
    // The recording strip grows upward with the composer anchored to the bottom.
    expect(after.x).toBe(before.x);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    expect(after.width).toBe(before.width);
    const send = page.getByRole('button', { name: 'ارسال پیام', exact: true });
    expect(Math.abs((await send.boundingBox())!.y - after.y)).toBeLessThan(2);
    await expect(send).toBeDisabled();
    await expect(page.getByLabel('مدت ضبط')).toHaveText('۰۰:۰۱');
    await page.getByRole('button', { name: 'مکث ضبط', exact: true }).click();
    const paused = await page.getByLabel('مدت ضبط').textContent();
    await page.waitForTimeout(1100);
    await expect(page.getByLabel('مدت ضبط')).toHaveText(paused!);
    await page.getByRole('button', { name: 'ادامه ضبط', exact: true }).click();
    await expect(page.getByLabel('مدت ضبط')).toHaveText('۰۰:۰۳');
    if (width === 390)
      await page.screenshot({ path: '.local/ui-preview/voice-recording-light.png' });
    await stop.click();
    await expect(page.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
    await expect(send).toBeEnabled();
    const decoded = await page.evaluate(async () => {
      const blob = (window as unknown as { recordedVoice: Blob }).recordedVoice;
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        const samples = audio.getChannelData(0),
          rate = audio.sampleRate;
        const rms = (offset: number) => {
          const part = samples.slice(Math.floor(offset * rate), Math.floor((offset + 0.1) * rate));
          return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length);
        };
        return {
          duration: audio.duration,
          events: (window as unknown as { voiceEvents: { type: string; at: number }[] })
            .voiceEvents,
          levels: [rms(0.1), rms(audio.duration / 2), rms(audio.duration - 0.2)],
        };
      } finally {
        await context.close();
      }
    });
    await testInfo.attach(`voice-duration-${width}`, {
      body: JSON.stringify(decoded),
      contentType: 'application/json',
    });
    expect(decoded.duration).toBeGreaterThan(2.8);
    expect(decoded.duration).toBeLessThan(3.8);
    for (const level of decoded.levels) expect(level).toBeGreaterThan(0.1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'حذف صدای ضبط‌شده', exact: true }).click();
    await expect(mic).toBeVisible();
  }
  await db.$disconnect();
});

test('finalizes automatically at the configured duration limit and produces an accepted playable upload', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { settings } = await import('@niticket/core/application/settings');
  const { scanInContainer } = await import('../helpers/scan-in-container');
  const f = await fixtures();
  const previous = await db.systemSetting.findUnique({ where: { key: 'policy' } });
  const policy = { ...(await settings()), maxVoiceSeconds: 10 };
  try {
    await db.systemSetting.upsert({
      where: { key: 'policy' },
      create: { key: 'policy', value: policy, updatedBy: f.admin.id },
      update: { value: policy },
    });
    const ticket = await db.ticket.create({
      data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'محدودیت ضبط صوت' },
    });
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin: 'http://localhost:3001' },
          data: { phoneNumber: f.student.phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`/tickets/${ticket.id}`);
    await page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
    await expect(page.getByRole('button', { name: 'پایان ضبط', exact: true })).toBeVisible();
    await expect(page.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
    await expect(page.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toHaveCount(0, {
      timeout: 30000,
    });
    await expect.poll(() => db.attachment.count({ where: { ticketId: ticket.id } })).toBe(1);
    const attachment = await db.attachment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    const event = await db.outboxEvent.findFirstOrThrow({
      where: {
        type: 'SCAN_ATTACHMENT',
        payload: { path: ['attachmentId'], equals: attachment.id },
      },
    });
    await scanInContainer(event.id);
    const scanned = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(scanned.scanStatus).toBe('CLEAN');
    expect(scanned.durationSeconds).toBeGreaterThan(9.5);
    expect(scanned.durationSeconds).toBeLessThanOrEqual(10.1);
    await page.reload();
    await page.getByRole('button', { name: 'پخش پیام صوتی', exact: true }).click();
    await expect(page.getByRole('button', { name: 'مکث پیام صوتی', exact: true })).toBeVisible();
  } finally {
    if (previous)
      await db.systemSetting.update({
        where: { key: 'policy' },
        data: { value: previous.value as Prisma.InputJsonValue },
      });
    else await db.systemSetting.deleteMany({ where: { key: 'policy' } });
    await db.$disconnect();
  }
});

test('settles the audio device before capture and preserves every short window of the first two seconds', async ({
  page,
}, testInfo) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'شروع پیوسته صدا' },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    const NativeContext = AudioContext;
    const events: { type: string; at: number }[] = [];
    Object.assign(window, { initializationEvents: events });
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        events.push({ type: 'context', at: performance.now() });
      }
      async resume() {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await super.resume();
        events.push({ type: 'meter-ready', at: performance.now() });
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new NativeContext();
      await context.resume();
      const tone = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      tone.connect(destination);
      tone.start();
      return destination.stream;
    };
    const NativeRecorder = MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      start(timeslice?: number) {
        events.push({ type: 'capture', at: performance.now() });
        super.start(timeslice);
      }
    };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type.startsWith('audio/'))
        Object.assign(window, { recordedVoice: blob });
      return create(blob);
    };
  });
  await page.goto(`/tickets/${ticket.id}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
    await expect(page.getByRole('button', { name: 'پایان ضبط', exact: true })).toBeVisible();
    await expect(page.getByLabel('مدت ضبط')).toHaveText('۰۰:۰۳');
    await page.getByRole('button', { name: 'پایان ضبط', exact: true }).click();
    await expect(page.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
    const decoded = await page.evaluate(async () => {
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(
          await (window as unknown as { recordedVoice: Blob }).recordedVoice.arrayBuffer(),
        );
        const samples = audio.getChannelData(0),
          rate = audio.sampleRate;
        const levels = [];
        for (let start = 0.08; start < 2.5; start += 0.04) {
          const part = samples.slice(Math.floor(start * rate), Math.floor((start + 0.04) * rate));
          levels.push(Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length));
        }
        let quietSamples = 0,
          longestQuiet = 0;
        for (const value of samples.slice(Math.floor(0.08 * rate), Math.floor(2.5 * rate))) {
          quietSamples = Math.abs(value) < 0.01 ? quietSamples + 1 : 0;
          longestQuiet = Math.max(longestQuiet, quietSamples);
        }
        return {
          levels,
          silenceMilliseconds: (longestQuiet / rate) * 1000,
          duration: audio.duration,
          events: (window as unknown as { initializationEvents: { type: string; at: number }[] })
            .initializationEvents,
        };
      } finally {
        await context.close();
      }
    });
    await testInfo.attach(`continuous-start-${attempt}`, {
      body: JSON.stringify(decoded),
      contentType: 'application/json',
    });
    expect(decoded.duration).toBeGreaterThan(2.8);
    expect(Math.min(...decoded.levels)).toBeGreaterThan(0.1);
    // Absolute RMS alone can miss a brief gap straddling two analysis windows.
    expect(Math.min(...decoded.levels)).toBeGreaterThan(Math.max(...decoded.levels) * 0.85);
    expect(decoded.silenceMilliseconds).toBeLessThan(5);
    const capture = decoded.events.map((event) => event.type).lastIndexOf('capture');
    expect(decoded.events[capture - 1].type).toBe('meter-ready');
    await page.getByRole('button', { name: 'حذف صدای ضبط‌شده', exact: true }).click();
  }
  await db.$disconnect();
});
