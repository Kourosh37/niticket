import { afterEach, expect, it } from 'vitest';
import {
  cachedRead,
  closeReadCache,
  invalidateLocalReads,
  withReadCache,
} from '@niticket/core/infrastructure/read-cache';

afterEach(closeReadCache);

it('coalesces concurrent readers, preserves dates and isolates mutable results', async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    return { at: new Date('2026-01-01'), nested: { value: 1 }, value: 3n };
  };
  const [a, b] = await Promise.all([
    cachedRead('one', ['catalog'], 10000, load),
    cachedRead('one', ['catalog'], 10000, load),
  ]);
  expect(calls).toBe(1);
  a.nested.value = 2;
  expect(b.nested.value).toBe(1);
  const warm = await cachedRead('one', ['catalog'], 10000, load);
  expect(warm.at).toBeInstanceOf(Date);
  expect(warm.value).toBe(3n);
  expect(warm.nested.value).toBe(1);
});

it('never resurrects an invalidated in-flight load and bypasses cache for read-after-write requests', async () => {
  let resolve!: (n: number) => void;
  const pending = cachedRead(
    'race',
    ['catalog'],
    10000,
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  );
  invalidateLocalReads(['catalog']);
  expect(await cachedRead('race', ['catalog'], 10000, async () => 2)).toBe(2);
  resolve(1);
  expect(await pending).toBe(1);
  expect(await cachedRead('race', ['catalog'], 10000, async () => 3)).toBe(2);
  expect(
    await withReadCache(true, () => cachedRead('race', ['catalog'], 10000, async () => 4)),
  ).toBe(4);
});

it('does not retain failed or oversized loads', async () => {
  await expect(
    cachedRead('failure', [], 1000, async () => {
      throw new Error('down');
    }),
  ).rejects.toThrow('down');
  expect(await cachedRead('failure', [], 1000, async () => 'recovered')).toBe('recovered');
  await cachedRead('large', [], 1000, async () => 'x'.repeat(300000));
  expect(await cachedRead('large', [], 1000, async () => 'fresh')).toBe('fresh');
});
