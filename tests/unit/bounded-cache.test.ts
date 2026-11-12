import { expect, it } from 'vitest';
import { BoundedCache } from '../../packages/core/src/domain/bounded-cache';

it('expires entries and evicts the least recently used value within both budgets', () => {
  let now = 0;
  const cache = new BoundedCache<number>({ entries: 2, bytes: 10 }, () => now);
  cache.set('a', 1, 100, 4);
  cache.set('b', 2, 100, 4);
  expect(cache.get('a')).toBe(1);
  cache.set('c', 3, 100, 4);
  expect(cache.get('b')).toBeUndefined();
  cache.set('large', 4, 100, 11);
  expect(cache.size).toBe(2);
  expect(cache.byteSize).toBe(8);
  now = 100;
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('c')).toBeUndefined();
  expect(cache.byteSize).toBe(0);
});

it('invalidates only tagged entries, replaces byte accounting and clears all state', () => {
  const cache = new BoundedCache<string>({ entries: 3, bytes: 100 });
  cache.set('a', 'first', 1000, 20, ['ticket:a']);
  cache.set('a', 'new', 1000, 10, ['ticket:a']);
  cache.set('b', 'second', 1000, 30, ['catalog']);
  expect(cache.byteSize).toBe(40);
  cache.invalidate(['ticket:a']);
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('b')).toBe('second');
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.byteSize).toBe(0);
});
