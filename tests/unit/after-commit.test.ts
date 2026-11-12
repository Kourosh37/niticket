import { expect, it, vi } from 'vitest';
import {
  afterCommit,
  withCommitCallbacks,
} from '../../packages/core/src/infrastructure/after-commit';

it('runs side effects only after the transaction resolves', async () => {
  const effect = vi.fn();
  let commit!: () => void;
  const result = withCommitCallbacks(async () => {
    afterCommit(effect);
    await new Promise<void>((resolve) => {
      commit = resolve;
    });
    return 'committed';
  });
  expect(effect).not.toHaveBeenCalled();
  commit();
  expect(await result).toBe('committed');
  expect(effect).toHaveBeenCalledOnce();
});

it('discards a failed attempt without retaining its side effects for a retry', async () => {
  const rejected = vi.fn(),
    committed = vi.fn();
  await expect(
    withCommitCallbacks(async () => {
      afterCommit(rejected);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  await withCommitCallbacks(async () => {
    afterCommit(committed);
  });
  expect(rejected).not.toHaveBeenCalled();
  expect(committed).toHaveBeenCalledOnce();
});

it('keeps simultaneous transactions isolated and preserves a committed result if a side effect fails', async () => {
  const calls: string[] = [];
  await Promise.all([
    withCommitCallbacks(async () => {
      afterCommit(() => calls.push('first'));
      await Promise.resolve();
    }),
    withCommitCallbacks(async () => {
      afterCommit(() => calls.push('second'));
    }),
  ]);
  expect(calls.sort()).toEqual(['first', 'second']);
  expect(
    await withCommitCallbacks(async () => {
      afterCommit(() => {
        throw new Error('broker');
      });
      return 42;
    }),
  ).toBe(42);
  expect(() => afterCommit(() => {})).toThrow('requires');
});
