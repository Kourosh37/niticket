import { expect, it } from 'vitest';
import { acceptsRange, matchesETag } from '../../packages/core/src/domain/http-cache';

it('compares GET validators weakly and accepts lists without matching unrelated versions', () => {
  expect(matchesETag('"old", W/"new"', '"new"')).toBe(true);
  expect(matchesETag('*', '"new"')).toBe(true);
  expect(matchesETag('"newer"', '"new"')).toBe(false);
  expect(matchesETag(undefined, '"new"')).toBe(false);
  expect(matchesETag('x'.repeat(9000), '"new"')).toBe(false);
});

it('allows byte ranges only with a matching strong validator or no If-Range', () => {
  expect(acceptsRange(undefined, '"new"')).toBe(true);
  expect(acceptsRange('"new"', '"new"')).toBe(true);
  expect(acceptsRange('W/"new"', '"new"')).toBe(false);
  expect(acceptsRange('"old"', '"new"')).toBe(false);
  expect(acceptsRange('Wed, 01 Jan 2025 00:00:00 GMT', '"new"')).toBe(false);
});
