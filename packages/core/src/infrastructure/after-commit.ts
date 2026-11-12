import { AsyncLocalStorage } from 'node:async_hooks';
import { log } from './log';

const callbacks = new AsyncLocalStorage<(() => void)[]>();

export function afterCommit(callback: () => void) {
  const pending = callbacks.getStore();
  if (!pending) throw new Error('After-commit work requires an application transaction');
  pending.push(callback);
}

export async function withCommitCallbacks<T>(work: () => Promise<T>) {
  const pending: (() => void)[] = [];
  const value = await callbacks.run(pending, work);
  // Rejected/rolled-back attempts never reach this point. Callbacks schedule
  // their own fallible delivery; a broker outage cannot undo committed data.
  for (const callback of pending) {
    try {
      callback();
    } catch (error) {
      log.warn(
        { operation: 'after_commit', category: error instanceof Error ? error.name : 'unknown' },
        'Post-commit work failed',
      );
    }
  }
  return value;
}
