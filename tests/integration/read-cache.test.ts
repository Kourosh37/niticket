import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from '@niticket/core/infrastructure/config';
import {
  cachedRead,
  invalidateSharedReads,
  closeReadCache,
  readCacheState,
  cacheNamespace,
} from '@niticket/core/infrastructure/read-cache';
import { redis } from '@niticket/core/infrastructure/redis';

vi.mock('@niticket/core/infrastructure/config', async (original) => {
  const source = await original<typeof import('@niticket/core/infrastructure/config')>();
  return {
    ...source,
    config: () => ({ ...source.config(), CACHE_REDIS_URL: source.config().REDIS_URL }),
  };
});

afterAll(() => {
  closeReadCache();
  redis().disconnect();
});

async function ready() {
  await expect
    .poll(async () => {
      await cachedRead(`warm:${randomUUID()}`, [], 100, async () => 1);
      return readCacheState().sharedReady;
    })
    .toBe(true);
}

it('uses isolated shared entries, preserves typed values and refreshes invalidated generations', async () => {
  await ready();
  const key = randomUUID(),
    tag = randomUUID();
  let calls = 0;
  const load = async () => {
    calls++;
    return { value: calls, date: new Date('2026-01-01') };
  };
  expect((await cachedRead(key, [tag], 10000, load)).value).toBe(1);
  expect((await cachedRead(key, [tag], 10000, load)).date).toBeInstanceOf(Date);
  expect(calls).toBe(1);
  await invalidateSharedReads([tag]);
  expect((await cachedRead(key, [tag], 10000, load)).value).toBe(2);
  expect(cacheNamespace()).toContain('_test');
  expect(config().CACHE_REDIS_URL).toBeTruthy();
});

it('cannot resurrect entries after epoch eviction or a concurrent invalidation', async () => {
  await ready();
  const key = randomUUID(),
    tag = randomUUID();
  expect(await cachedRead(key, [tag], 10000, async () => 1)).toBe(1);
  await redis().del(`${cacheNamespace()}:tag:${tag}`);
  expect(await cachedRead(key, [tag], 10000, async () => 2)).toBe(2);
  let resolve!: (n: number) => void;
  const pending = cachedRead(
    randomUUID(),
    [tag],
    10000,
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  );
  await expect.poll(() => typeof resolve).toBe('function');
  await invalidateSharedReads([tag]);
  resolve(3);
  await pending;
  expect(readCacheState().flights).toBe(0);
});
