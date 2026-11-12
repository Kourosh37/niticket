// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { clientCache } from '../../apps/web/src/lib/client-cache';
import { clearTicketDraft, readDraft, saveDraft } from '../../apps/web/src/lib/conversation-memory';

afterEach(() => {
  clientCache.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});

it('restores text per conversation and never exposes an internal draft to a public composer', () => {
  clientCache.activate('one');
  saveDraft('a', 'private', 'INTERNAL');
  expect(readDraft('a', false)).toBeNull();
  expect(readDraft('a', true)?.body).toBe('private');
  expect(readDraft('b', true)).toBeNull();
  saveDraft('b', 'public', 'PUBLIC');
  expect(readDraft('b', false)?.body).toBe('public');
  clearTicketDraft('a');
  expect(readDraft('a', true)).toBeNull();
});

it('expires drafts and clears persisted content on logout or account changes', async () => {
  vi.useFakeTimers();
  clientCache.activate('one');
  saveDraft('a', 'secret', 'PUBLIC');
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(readDraft('a', false)).toBeNull();
  saveDraft('a', 'again', 'PUBLIC');
  expect(sessionStorage.length).toBe(1);
  clientCache.activate('two');
  expect(readDraft('a', false)).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it('does not lose composing when session storage is unavailable and bounds retained draft count', () => {
  clientCache.activate('one');
  for (let i = 0; i < 50; i++) saveDraft(String(i), 'text', 'PUBLIC');
  expect(sessionStorage.length).toBeLessThanOrEqual(32);
  expect(readDraft('49', false)?.body).toBe('text');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => saveDraft('quota', 'memory fallback', 'PUBLIC')).not.toThrow();
  expect(readDraft('quota', false)?.body).toBe('memory fallback');
  vi.restoreAllMocks();
});
