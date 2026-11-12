// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRealtimeSync } from '../../apps/web/src/lib/use-realtime-sync';
import type { RealtimeSignal } from '../../apps/web/src/lib/realtime-client';

const { transport } = vi.hoisted(() => ({
  transport: { live: false, listeners: new Set<(signal: RealtimeSignal) => void>() },
}));
vi.mock('../../apps/web/src/lib/realtime-client', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/realtime-client')>()),
  realtime: {
    get live() {
      return transport.live;
    },
    subscribe: (listener: (signal: RealtimeSignal) => void) => {
      transport.listeners.add(listener);
      return () => transport.listeners.delete(listener);
    },
  },
}));

function emit(signal: RealtimeSignal) {
  for (const listener of transport.listeners) listener(signal);
}

beforeEach(() => {
  vi.useFakeTimers();
  transport.live = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup();
  transport.listeners.clear();
  vi.useRealTimers();
});

it('coalesces bursts and retains a change that arrives while the HTTP snapshot is in flight', async () => {
  let resolve!: () => void;
  const work = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(undefined);
  renderHook(() => useRealtimeSync(work, ['conversation'], { ticketId: 'mine' }));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(work).toHaveBeenCalledTimes(1);
  act(() => {
    for (let i = 0; i < 20; i++)
      emit({ kind: 'change', topics: ['conversation'], ticketIds: ['mine'] });
  });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(work).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(work).toHaveBeenCalledTimes(2);
  act(() => emit({ kind: 'change', topics: ['conversation'], ticketIds: ['other'] }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(work).toHaveBeenCalledTimes(2);
});

it('uses slow reconciliation when live, falls back promptly after disconnect and cancels on unmount', async () => {
  transport.live = true;
  const work = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(() => useRealtimeSync(work, ['inbox']));
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(work).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(50001));
  expect(work).toHaveBeenCalledTimes(2);
  act(() => {
    transport.live = false;
    emit({ kind: 'state', live: false });
  });
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(work.mock.calls.length).toBeGreaterThanOrEqual(4);
  view.unmount();
  const count = work.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(120000));
  expect(work).toHaveBeenCalledTimes(count);
  expect(transport.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('defers busy and hidden consumers without losing their invalidation', async () => {
  let busy = true;
  const work = vi.fn(() => !busy);
  renderHook(() => useRealtimeSync(work, ['inbox']));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(work).toHaveBeenCalledTimes(1);
  busy = false;
  await act(() => vi.advanceTimersByTimeAsync(750));
  expect(work).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => emit({ kind: 'ready' }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(work).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(work).toHaveBeenCalledTimes(3);
});

it('recovers rejected requests and uses the latest callback without reconnecting subscriptions', async () => {
  transport.live = true;
  const first = vi.fn().mockRejectedValue(new TypeError('Offline'));
  const second = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(({ work }) => useRealtimeSync(work, ['inbox']), {
    initialProps: { work: first },
  });
  await act(() => vi.advanceTimersByTimeAsync(1));
  view.rerender({ work: second });
  act(() => emit({ kind: 'ready' }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(second).toHaveBeenCalledTimes(1);
  expect(transport.listeners.size).toBe(1);
});

it('retries failed HTTP reads with bounded backoff while a stream remains healthy', async () => {
  transport.live = true;
  const work = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Temporary HTTP failure'))
    .mockResolvedValue(undefined);
  renderHook(() => useRealtimeSync(work, ['conversation']));
  await act(() => vi.advanceTimersByTimeAsync(1));
  await act(() => vi.advanceTimersByTimeAsync(4998));
  expect(work).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(work).toHaveBeenCalledTimes(2);
});

it('supports consumers whose debounced HTTP loader already handles initial data', async () => {
  const work = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useRealtimeSync(work, ['saved-replies'], { initial: false }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(work).not.toHaveBeenCalled();
  act(() => emit({ kind: 'change', topics: ['saved-replies'], ticketIds: [] }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(work).toHaveBeenCalledTimes(1);
});
