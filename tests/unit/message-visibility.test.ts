// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { observeVisibleMessages } from '../../apps/web/src/lib/message-visibility';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reports sufficiently visible rows, handles virtualization and disconnects without stale callbacks', async () => {
  vi.useFakeTimers();
  let report: IntersectionObserverCallback;
  const observe = vi.fn(),
    unobserve = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        report = callback;
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  const root = document.createElement('div');
  root.innerHTML = '<article data-message-id="first"></article>';
  document.body.append(root);
  const notify = vi.fn(),
    stop = observeVisibleMessages(root, notify),
    first = root.firstElementChild!;
  const entry = (target: Element, height: number) =>
    ({
      target,
      isIntersecting: height > 0,
      intersectionRect: { height },
      boundingClientRect: { height: 100 },
    }) as IntersectionObserverEntry;
  report!([entry(first, 10)], {} as IntersectionObserver);
  await vi.advanceTimersByTimeAsync(100);
  expect(notify).toHaveBeenLastCalledWith([]);
  report!([entry(first, 60)], {} as IntersectionObserver);
  await vi.advanceTimersByTimeAsync(100);
  expect(notify).toHaveBeenLastCalledWith(['first']);
  (first as HTMLElement).dataset.messageId = 'recycled';
  await vi.advanceTimersByTimeAsync(132);
  expect(notify).toHaveBeenLastCalledWith([]);
  report!([entry(first, 60)], {} as IntersectionObserver);
  await vi.advanceTimersByTimeAsync(100);
  expect(notify).toHaveBeenLastCalledWith(['recycled']);
  root.innerHTML = '<article data-message-id="second"></article>';
  await vi.advanceTimersByTimeAsync(32);
  expect(unobserve).toHaveBeenCalledWith(first);
  expect(observe).toHaveBeenCalledTimes(3);
  report!([entry(root.firstElementChild!, 70)], {} as IntersectionObserver);
  await vi.advanceTimersByTimeAsync(100);
  expect(notify).toHaveBeenLastCalledWith(['second']);
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenLastCalledWith([]);
  notify.mockClear();
  await vi.advanceTimersByTimeAsync(1000);
  expect(notify).not.toHaveBeenCalled();
});
