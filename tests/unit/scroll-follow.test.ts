import { expect, it } from 'vitest';
import { shouldFollowLatest } from '../../apps/web/src/lib/scroll-follow';

it('keeps a detached reader detached through virtualizer corrections and resumes only after a return gesture', () => {
  const reader = {
    following: false,
    initial: false,
    returning: false,
    restoring: false,
    gap: 0,
    movingUp: false,
    resized: true,
  };
  expect(shouldFollowLatest(reader)).toBe(false);
  expect(shouldFollowLatest({ ...reader, returning: true })).toBe(true);
  expect(shouldFollowLatest({ ...reader, returning: true, movingUp: true })).toBe(false);
  expect(shouldFollowLatest({ ...reader, following: true, returning: true, restoring: true })).toBe(
    false,
  );
  expect(shouldFollowLatest({ ...reader, initial: true, gap: 90 })).toBe(true);
  expect(shouldFollowLatest({ ...reader, following: true, gap: 500 })).toBe(true);
});
