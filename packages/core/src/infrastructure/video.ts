import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export async function inspectVideo(bytes: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'niticket-video-'));
  try {
    const file = path.join(directory, 'input');
    await writeFile(file, bytes);
    const { stdout } = await promisify(execFile)(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_entries',
        'format=duration:stream=codec_type',
        '-of',
        'json',
        file,
      ],
      { timeout: 15000, maxBuffer: 65536 },
    );
    const info = z
      .object({
        streams: z.array(z.object({ codec_type: z.string() })),
        format: z.object({ duration: z.coerce.number().positive().optional() }).optional(),
      })
      .parse(JSON.parse(stdout));
    if (!info.streams.some((stream) => stream.codec_type === 'video'))
      throw new Error('Video stream invalid');
    return { durationSeconds: info.format?.duration ?? null };
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number')
    )
      throw new Error('Video stream invalid');
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
