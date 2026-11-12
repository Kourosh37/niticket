import { afterAll, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { db } from '@niticket/database';
import { config } from '@niticket/core/infrastructure/config';
import {
  closeReadCache,
  cachedRead,
  readCacheState,
} from '@niticket/core/infrastructure/read-cache';
import { publishRealtimeEvent } from '@niticket/core/infrastructure/realtime';
import { redis } from '@niticket/core/infrastructure/redis';

vi.mock('@niticket/core/infrastructure/config', async (original) => {
  const source = await original<typeof import('@niticket/core/infrastructure/config')>();
  return {
    ...source,
    config: () => ({ ...source.config(), CACHE_REDIS_URL: source.config().REDIS_URL }),
  };
});

afterAll(async () => {
  closeReadCache();
  redis().disconnect();
  await db.$disconnect();
});

it('retains failed invalidation for retry and refreshes a warm cache in another process after recovery', async () => {
  const child = spawn(process.execPath, ['tests/helpers/cache-peer.ts'], {
    env: { ...process.env, CACHE_REDIS_URL: config().REDIS_URL },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: child.stdout });
  const replies: string[] = [];
  lines.on('line', (line) => replies.push(line));

  async function next() {
    await expect.poll(() => replies.length, { timeout: 10000 }).toBeGreaterThan(0);
    return replies.shift()!;
  }

  try {
    expect(await next()).toBe('ready');
    await expect
      .poll(async () => {
        await cachedRead(randomUUID(), [], 100, async () => 0);
        return readCacheState().sharedReady;
      })
      .toBe(true);
    const userId = randomUUID(),
      tag = `user:${userId}`,
      key = randomUUID();
    expect(await cachedRead(key, [tag], 30000, async () => 1)).toBe(1);
    const readPeer = async (value: number) => {
      child.stdin.write(JSON.stringify({ key, tag, value }) + '\n');
      return JSON.parse(await next()) as number;
    };
    expect(await readPeer(2)).toBe(1);
    const payload = { scope: 'user', userId, topics: ['inbox'] };
    const event = await db.outboxEvent.create({ data: { type: 'REALTIME_INVALIDATION', payload } });
    const failure = vi.spyOn(Redis.prototype, 'pipeline').mockReturnValueOnce({
      set() {
        return this;
      },
      exec: async () => [[new Error('isolated command failure'), null]],
    } as unknown as ReturnType<Redis['pipeline']>);
    try {
      await expect(publishRealtimeEvent(event.id, payload)).rejects.toThrow(
        'invalidation deferred',
      );
    } finally {
      failure.mockRestore();
    }
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
    ).toBeNull();
    expect(await readPeer(2)).toBe(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5001);
    try {
      await publishRealtimeEvent(event.id, payload);
    } finally {
      clock.mockRestore();
    }
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
    ).not.toBeNull();
    expect(await readPeer(2)).toBe(2);
  } finally {
    lines.close();
    child.stdin.end();
    const exit = once(child, 'exit');
    const timer = setTimeout(() => child.kill(), 3000);
    await exit;
    clearTimeout(timer);
  }
});
