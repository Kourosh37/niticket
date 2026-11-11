import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export function pcmWaveform(pcm: Buffer, bins = 80) {
  const count = Math.floor(pcm.length / 2);
  if (!count) return Array.from({ length: bins }, () => 0);
  const rms = Array.from({ length: bins }, (_, bin) => {
    const start = Math.floor((bin * count) / bins),
      end = Math.floor(((bin + 1) * count) / bins);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      sum += sample * sample;
    }
    return Math.sqrt(sum / Math.max(1, end - start));
  });
  const peak = Math.max(...rms);
  return rms.map((v) => (peak ? Math.round(Math.sqrt(v / peak) * 1000) / 1000 : 0));
}

export async function inspectAudio(bytes: Buffer, maxSeconds: number) {
  const dir = await mkdtemp(path.join(tmpdir(), 'niticket-audio-'));
  try {
    const file = path.join(dir, 'input');
    await writeFile(file, bytes);
    const { stdout } = await promisify(execFile)(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file],
      { timeout: 15000, maxBuffer: 65536 },
    );
    const info = z
      .object({
        streams: z.array(z.object({ codec_type: z.string() })),
      })
      .parse(JSON.parse(stdout));
    if (
      info.streams.some((s) => s.codec_type === 'video') ||
      !info.streams.some((s) => s.codec_type === 'audio')
    )
      throw new Error('Audio duration or stream invalid');
    const decoded = await promisify(execFile)(
      'ffmpeg',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        file,
        '-t',
        String(maxSeconds + 1),
        '-vn',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { timeout: 20000, maxBuffer: 12000000, encoding: 'buffer' },
    );
    // Browser MediaRecorder WebM frequently omits container duration. Decode the
    // samples to measure the real duration and enforce the limit for all formats.
    const durationSeconds = decoded.stdout.length / 16000;
    // Encoders finish whole frames: a recorder stopped at 10s can decode to
    // 10.02s of Opus (or one AAC frame more). Preserve the tail and allow only
    // 100ms of framing/timer precision rather than rejecting a valid recording.
    if (durationSeconds <= 0 || durationSeconds > maxSeconds + 0.1)
      throw new Error('Audio duration invalid');
    return { durationSeconds, waveform: pcmWaveform(decoded.stdout) };
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number')
    )
      throw new Error('Audio duration or stream invalid');
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
