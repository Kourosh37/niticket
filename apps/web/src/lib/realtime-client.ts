export const topics = [
  'conversation',
  'inbox',
  'receipts',
  'notifications',
  'attachments',
  'saved-replies',
  'access',
] as const;

export type Topic = (typeof topics)[number];

export type RealtimeSignal =
  | { kind: 'ready' }
  | { kind: 'state'; live: boolean }
  | { kind: 'change'; topics: Topic[]; ticketIds: string[] };

type Listener = (signal: RealtimeSignal) => void;

/** One transport per signed-in shell. Streams contain invalidations, never message data. */
export class RealtimeClient {
  private source?: EventSource;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private listeners = new Set<Listener>();
  private stopped = true;
  private attempts = 0;
  private lastEvent = 0;
  live = false;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(signal: RealtimeSignal) {
    for (const listener of this.listeners) listener(signal);
  }

  private setLive(live: boolean) {
    if (this.live === live) return;
    this.live = live;
    this.emit({ kind: 'state', live });
  }

  private disconnect() {
    this.source?.close();
    this.source = undefined;
    clearTimeout(this.retry);
    clearInterval(this.watchdog);
    this.setLive(false);
  }

  private reconnect = () => {
    this.disconnect();
    if (this.stopped || !navigator.onLine) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5));
    this.retry = setTimeout(this.connect, delay * (0.8 + Math.random() * 0.4));
  };

  private connect = () => {
    if (this.stopped || !navigator.onLine || typeof EventSource === 'undefined') return;
    this.disconnect();
    let source: EventSource;
    try {
      source = new EventSource('/api/v1/events');
    } catch {
      this.reconnect();
      return;
    }
    this.source = source;
    this.lastEvent = Date.now();
    const current = () => !this.stopped && this.source === source;
    source.addEventListener('ready', () => {
      if (!current()) return;
      this.lastEvent = Date.now();
      this.attempts = 0;
      this.setLive(true);
      // Redis Pub/Sub has no replay: every connection reconciles through HTTP.
      this.emit({ kind: 'ready' });
    });
    source.addEventListener('heartbeat', () => {
      if (current()) this.lastEvent = Date.now();
    });
    source.addEventListener('change', (event) => {
      if (!current()) return;
      try {
        const raw = (event as MessageEvent<string>).data;
        if (raw.length > 16384) throw new Error('Oversized event');
        const update: unknown = JSON.parse(raw);
        if (!update || typeof update !== 'object') throw new Error('Invalid event');
        const { topics: changed, ticketIds } = update as Record<string, unknown>;
        if (
          !Array.isArray(changed) ||
          changed.length > topics.length ||
          !changed.every((topic) => topics.includes(topic)) ||
          !Array.isArray(ticketIds) ||
          ticketIds.length > 64 ||
          !ticketIds.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
        )
          throw new Error('Invalid event');
        this.lastEvent = Date.now();
        this.emit({ kind: 'change', topics: changed, ticketIds });
      } catch {
        this.reconnect();
      }
    });
    source.addEventListener('auth', () => {
      if (!current()) return;
      this.disconnect();
      this.stopped = true;
      window.dispatchEvent(new Event('session:invalid'));
    });
    source.addEventListener('error', () => {
      if (!current()) return;
      // EventSource hides HTTP status codes. Check auth separately; network
      // failures must never sign out a valid user.
      window.dispatchEvent(new Event('session:check'));
      this.reconnect();
    });
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastEvent > 45000) this.reconnect();
    }, 10000);
  };

  start() {
    this.stopped = false;
    this.attempts = 0;
    this.connect();
    const online = () => this.connect();
    const offline = () => this.disconnect();
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      this.stopped = true;
      this.disconnect();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }
}

export const realtime = new RealtimeClient();

export function matchesSignal(
  signal: RealtimeSignal,
  selected: readonly Topic[],
  ticketId?: string,
) {
  return (
    signal.kind !== 'change' ||
    signal.topics.includes('access') ||
    (selected.some((topic) => signal.topics.includes(topic)) &&
      (!ticketId || !signal.ticketIds.length || signal.ticketIds.includes(ticketId)))
  );
}
