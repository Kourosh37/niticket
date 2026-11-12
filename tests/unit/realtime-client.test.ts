// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RealtimeClient, matchesSignal } from '../../apps/web/src/lib/realtime-client';

class FakeSource extends EventTarget {
  static instances: FakeSource[] = [];
  closed = false;
  constructor(public url: string) {
    super();
    FakeSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  send(type: string, data: unknown = {}) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeSource);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  FakeSource.instances = [];
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('shares one connection among consumers and accepts only bounded, recognized invalidations', () => {
  const client = new RealtimeClient(),
    a = vi.fn(),
    b = vi.fn();
  client.subscribe(a);
  client.subscribe(b);
  stop = client.start();
  const source = FakeSource.instances[0];
  expect(source.url).toBe('/api/v1/events');
  source.send('ready');
  source.send('change', {
    topics: ['conversation'],
    ticketIds: ['00000000-0000-4000-8000-000000000000'],
  });
  expect(client.live).toBe(true);
  expect(a.mock.calls).toEqual(b.mock.calls);
  expect(a).toHaveBeenLastCalledWith({
    kind: 'change',
    topics: ['conversation'],
    ticketIds: ['00000000-0000-4000-8000-000000000000'],
  });
  expect(FakeSource.instances).toHaveLength(1);
  source.send('change', { topics: ['unknown'], ticketIds: [] });
  expect(source.closed).toBe(true);
  expect(client.live).toBe(false);
});

it('uses bounded reconnect backoff, checks opaque authentication failures and resyncs every connection', async () => {
  const client = new RealtimeClient(),
    listener = vi.fn(),
    check = vi.fn();
  window.addEventListener('session:check', check);
  client.subscribe(listener);
  stop = client.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const source = FakeSource.instances.at(-1)!;
    source.send('error');
    expect(source.closed).toBe(true);
    const count = FakeSource.instances.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(FakeSource.instances).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.instances).toHaveLength(count + 1);
  }
  expect(check).toHaveBeenCalledTimes(7);
  FakeSource.instances.at(-1)!.send('ready');
  expect(listener).toHaveBeenLastCalledWith({ kind: 'ready' });
  expect(client.live).toBe(true);
  window.removeEventListener('session:check', check);
});

it('reconnects stalled streams but heartbeats keep healthy streams alive', async () => {
  const client = new RealtimeClient();
  stop = client.start();
  const source = FakeSource.instances[0];
  source.send('ready');
  for (let index = 0; index < 6; index++) {
    await vi.advanceTimersByTimeAsync(15000);
    source.send('heartbeat');
  }
  expect(source.closed).toBe(false);
  await vi.advanceTimersByTimeAsync(51000);
  expect(source.closed).toBe(true);
  expect(FakeSource.instances).toHaveLength(2);
});

it('pauses offline, resumes online and releases all timers and listeners on unmount', async () => {
  const client = new RealtimeClient(),
    listener = vi.fn();
  client.subscribe(listener);
  stop = client.start();
  const old = FakeSource.instances[0];
  old.send('ready');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  window.dispatchEvent(new Event('offline'));
  await vi.advanceTimersByTimeAsync(120000);
  expect(FakeSource.instances).toHaveLength(1);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  window.dispatchEvent(new Event('online'));
  expect(FakeSource.instances).toHaveLength(2);
  stop();
  listener.mockClear();
  old.send('ready');
  FakeSource.instances[1].send('ready');
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(120000);
  expect(FakeSource.instances).toHaveLength(2);
  expect(listener).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops reconnecting on explicit session revocation', async () => {
  const client = new RealtimeClient(),
    invalid = vi.fn();
  window.addEventListener('session:invalid', invalid);
  stop = client.start();
  FakeSource.instances[0].send('ready');
  FakeSource.instances[0].send('auth');
  await vi.advanceTimersByTimeAsync(120000);
  window.dispatchEvent(new Event('online'));
  expect(client.live).toBe(false);
  expect(invalid).toHaveBeenCalledTimes(1);
  expect(FakeSource.instances).toHaveLength(1);
  window.removeEventListener('session:invalid', invalid);
});

it('allows HTTP fallback when EventSource is unsupported', () => {
  vi.stubGlobal('EventSource', undefined);
  const client = new RealtimeClient();
  stop = client.start();
  expect(client.live).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('matches topics and ticket scopes while always reconciling access changes and reconnects', () => {
  expect(
    matchesSignal(
      { kind: 'change', topics: ['receipts'], ticketIds: ['other'] },
      ['receipts'],
      'mine',
    ),
  ).toBe(false);
  expect(
    matchesSignal({ kind: 'change', topics: ['inbox'], ticketIds: ['mine'] }, ['receipts'], 'mine'),
  ).toBe(false);
  expect(
    matchesSignal({ kind: 'change', topics: ['access'], ticketIds: [] }, ['receipts'], 'mine'),
  ).toBe(true);
  expect(matchesSignal({ kind: 'ready' }, ['receipts'], 'mine')).toBe(true);
});
