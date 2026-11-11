import { expect, it } from 'vitest';
import { byteRange } from '@niticket/core/domain/byte-range';

it('supports inclusive, open and suffix ranges without exceeding the approved object size', () => {
  expect(byteRange(undefined, 100)).toBeUndefined();
  expect(byteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
  expect(byteRange('bytes=20-', 100)).toEqual({ start: 20, end: 99 });
  expect(byteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  expect(byteRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 });
  expect(byteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
  for (const value of [
    'bytes=100-',
    'bytes=9-2',
    'bytes=-0',
    'bytes=-',
    'bytes=1-2,3-4',
    'items=1-2',
    'bytes=9999999999999999999-',
  ])
    expect(byteRange(value, 100)).toBeNull();
});
