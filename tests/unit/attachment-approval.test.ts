import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitForAttachmentApproval } from '../../apps/web/src/lib/attachment-approval';
import { RequestError } from '../../apps/web/src/lib/utils';
import { realtime, type RealtimeSignal } from '../../apps/web/src/lib/realtime-client';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  request.mockReset();
  realtime.live = false;
  vi.restoreAllMocks();
});

it('wakes approval immediately on an attachment invalidation and removes the waiting listener', async () => {
  realtime.live = true;
  let notify!: (signal: RealtimeSignal) => void;
  const unsubscribe = vi.fn();
  vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => {
    notify = listener;
    return unsubscribe;
  });
  request
    .mockResolvedValueOnce([file('a', 'QUARANTINED')])
    .mockResolvedValueOnce([file('a', 'CLEAN')]);
  const waiting = waitForAttachmentApproval(['a'], { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(1);
  notify({ kind: 'change', topics: ['attachments'], ticketIds: [] });
  await waiting;
  expect(request).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
const file = (id: string, scanStatus: string) => ({ id, filename: `${id}.pdf`, scanStatus });

it('waits for every attachment, including omitted statuses, and ignores unrelated approved files', async () => {
  const onProgress = vi.fn();
  request
    .mockResolvedValueOnce([file('a', 'CLEAN'), file('b', 'QUARANTINED')])
    .mockResolvedValueOnce([file('a', 'CLEAN'), file('other', 'CLEAN')])
    .mockResolvedValueOnce([file('a', 'CLEAN'), file('b', 'CLEAN')]);
  let complete = false;
  const waiting = waitForAttachmentApproval(['a', 'b', 'a'], {
    signal: new AbortController().signal,
    onProgress,
  }).then(() => {
    complete = true;
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(complete).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  await waiting;
  expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  expect(request.mock.calls.every(([url]) => url.endsWith('ids=a,b'))).toBe(true);
});

it('rejects a denied file with its name instead of returning an unusable saved reply', async () => {
  request.mockResolvedValue([file('a', 'CLEAN'), file('b', 'REJECTED')]);
  await expect(
    waitForAttachmentApproval(['a', 'b'], { signal: new AbortController().signal }),
  ).rejects.toThrow('b.pdf');
});

it('retries transient network and worker failures', async () => {
  request
    .mockRejectedValueOnce(new TypeError('Offline'))
    .mockRejectedValueOnce(new RequestError('Unavailable', undefined, 503))
    .mockResolvedValueOnce([file('a', 'CLEAN')]);
  const waiting = waitForAttachmentApproval(['a'], { signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(6000);
  await waiting;
  expect(request).toHaveBeenCalledTimes(3);
});

it.each([401, 403, 404])(
  'does not retry an authorization or missing-file error (%s)',
  async (status) => {
    request.mockRejectedValue(new RequestError('Denied', undefined, status));
    await expect(
      waitForAttachmentApproval(['a'], { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ status });
    expect(request).toHaveBeenCalledOnce();
  },
);

it('cancels an in-flight request and clears its timer when the editor unmounts', async () => {
  const abort = new AbortController();
  let requestedSignal!: AbortSignal;
  request.mockImplementation((_url: string, { signal }: { signal: AbortSignal }) => {
    requestedSignal = signal;
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason)),
    );
  });
  const rejected = expect(
    waitForAttachmentApproval(['a'], { signal: abort.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await rejected;
  expect(requestedSignal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds a stalled request and explains that uploaded files need no reupload', async () => {
  request.mockImplementation(
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  );
  const rejected = expect(
    waitForAttachmentApproval(['a'], { signal: new AbortController().signal, timeoutMs: 3000 }),
  ).rejects.toThrow('نیازی به بارگذاری دوباره');
  await vi.advanceTimersByTimeAsync(3000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it('makes no requests for text-only replies or an already cancelled editor', async () => {
  await waitForAttachmentApproval([], { signal: new AbortController().signal });
  const abort = new AbortController();
  abort.abort();
  await expect(waitForAttachmentApproval(['a'], { signal: abort.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(request).not.toHaveBeenCalled();
});
