import { afterEach, expect, it, vi } from 'vitest';
import { ClientCache, queryPolicy } from '../../apps/web/src/lib/client-cache';

afterEach(() => vi.useRealTimers());

it('shares simultaneous reads and gives each consumer independent data', async () => {
  const cache = new ClientCache();
  cache.activate('first');
  let calls = 0;
  const load = async () => {
    calls++;
    return { nested: { count: 1 } };
  };
  const [a, b] = await Promise.all([
    cache.load('one', ['catalog'], 10000, load),
    cache.load('one', ['catalog'], 10000, load),
  ]);
  a.nested.count = 2;
  expect(b.nested.count).toBe(1);
  expect(calls).toBe(1);
  expect((await cache.load('one', ['catalog'], 10000, load)).nested.count).toBe(1);
});

it('cancels one reader independently and aborts the network only after the last reader leaves', async () => {
  const cache = new ClientCache();
  cache.activate('first');
  let network!: AbortSignal;
  const load = (signal: AbortSignal) => {
    network = signal;
    return new Promise<number>((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason)),
    );
  };
  const a = new AbortController(),
    b = new AbortController();
  const first = cache.load('one', [], 1000, load, a.signal),
    second = cache.load('one', [], 1000, load, b.signal);
  const deniedA = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  a.abort();
  await deniedA;
  expect(network.aborted).toBe(false);
  const deniedB = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  b.abort();
  await deniedB;
  expect(network.aborted).toBe(true);
  expect(cache.state.pending).toBe(0);
});

it('does not publish an invalidated old read over a newer result', async () => {
  const cache = new ClientCache();
  cache.activate('first');
  let resolve!: (n: number) => void;
  const old = cache.load(
    'one',
    ['catalog'],
    10000,
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  );
  cache.invalidate(['catalog']);
  expect(await cache.load('one', ['catalog'], 10000, async () => 2)).toBe(2);
  resolve(1);
  await old;
  expect(cache.peek('one')).toBe(2);
});

it('expires entries, does not retain failures and clears private results when the account changes', async () => {
  vi.useFakeTimers();
  const cache = new ClientCache();
  cache.activate('first');
  await expect(
    cache.load('failure', [], 1000, async () => {
      throw new Error('offline');
    }),
  ).rejects.toThrow('offline');
  expect(await cache.load('failure', [], 1000, async () => 1)).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(cache.peek('failure')).toBeUndefined();
  cache.remember('private', ['secret'], ['catalog']);
  cache.activate('second');
  expect(cache.peek('private')).toBeUndefined();
  expect(cache.state.bytes).toBe(0);
});

it('invalidates receipt-sensitive pages and keeps authentication endpoints outside query caching', () => {
  const cache = new ClientCache();
  cache.activate('first');
  cache.remember('messages', [1], ['ticket:one']);
  cache.changed({ kind: 'change', topics: ['receipts'], ticketIds: ['one'] });
  expect(cache.peek('messages')).toBeUndefined();
  expect(queryPolicy('/api/auth/get-session')).toBeUndefined();
  expect(queryPolicy('/api/v1/tickets/id/sync')).toBeUndefined();
  expect(queryPolicy('/api/v1/attachments/id/metadata')).toBeUndefined();
  expect(queryPolicy('https://untrusted.example/api/v1/search')).toBeUndefined();
  expect(queryPolicy('/api/v1/search?b=2&a=1')?.key).toBe('/api/v1/search?a=1&b=2');
});

it('refreshes ticket queries after a write without discarding retained reading positions', () => {
  const cache = new ClientCache();
  cache.activate('first');
  cache.remember('messages', [1], ['ticket:one']);
  cache.remember('position', { id: 'older', offset: 42 }, ['ui-snapshot', 'catalog']);
  cache.mutated('/api/v1/tickets/one/read');
  expect(cache.peek('messages')).toBeUndefined();
  expect(cache.peek('position')).toEqual({ id: 'older', offset: 42 });
  expect(cache.freshUntil).toBeGreaterThan(Date.now());
  cache.mutated('/api/v1/admin/departments/one');
  expect(cache.peek('position')).toBeUndefined();
});
