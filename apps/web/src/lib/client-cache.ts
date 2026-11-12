import { BoundedCache } from '@niticket/core/domain/bounded-cache';
import type { RealtimeSignal } from './realtime-client';

type Flight = {
  controller: AbortController;
  promise: Promise<unknown>;
  readers: number;
  settled: boolean;
};

/** Private, tab-local cache. Clearing a session aborts requests and destroys all retained data. */
export class ClientCache {
  private data = new BoundedCache<unknown>({ entries: 160, bytes: 6 * 1024 * 1024 });
  private pending = new Map<string, Flight>();
  private epoch = 0;
  scope: string | null = null;
  freshUntil = 0;

  activate(scope: string) {
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
  }

  clear() {
    this.epoch++;
    this.data.clear();
    for (const flight of this.pending.values()) flight.controller.abort();
    this.pending.clear();
    this.scope = null;
  }

  invalidate(tags: string[]) {
    this.epoch++;
    this.data.invalidate(tags);
  }

  peek<T>(key: string): T | undefined {
    if (!this.scope) return;
    const value = this.data.get(`${this.scope}:${key}`);
    return value === undefined ? undefined : structuredClone(value as T);
  }

  remember(key: string, value: unknown, tags: string[], ttl = 60000) {
    if (!this.scope) return;
    const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    this.data.set(`${this.scope}:${key}`, structuredClone(value), ttl, size, tags);
  }

  async load<T>(
    key: string,
    tags: string[],
    ttl: number,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (!this.scope || this.freshUntil > Date.now())
      return load(signal ?? new AbortController().signal);
    const warm = this.peek<T>(key);
    if (warm !== undefined) return warm;
    const epoch = this.epoch,
      scope = this.scope;
    const id = `${scope}:${key}:${epoch}`;
    let flight = this.pending.get(id);
    if (!flight) {
      if (this.pending.size >= 64) return load(signal ?? new AbortController().signal);
      const controller = new AbortController();
      flight = { controller, readers: 0, settled: false, promise: Promise.resolve() };
      const current = flight;
      current.promise = load(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted && this.epoch === epoch && this.scope === scope)
            this.remember(key, value, tags, ttl);
          return value;
        })
        .finally(() => {
          current.settled = true;
          if (this.pending.get(id) === current) this.pending.delete(id);
        });
      // A consumer can cancel before it attaches its handlers.
      void current.promise.catch(() => {});
      this.pending.set(id, current);
    }
    const current = flight;
    current.readers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        current.readers--;
        if (!current.readers && !current.settled) {
          current.controller.abort();
          if (this.pending.get(id) === current) this.pending.delete(id);
        }
      };
      const abort = () => {
        release();
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(
        (value) => {
          if (!finished) {
            release();
            resolve(structuredClone(value as T));
          }
        },
        (error) => {
          if (!finished) {
            release();
            reject(error);
          }
        },
      );
      if (signal?.aborted) abort();
    });
  }

  changed(signal: RealtimeSignal) {
    if (signal.kind === 'change' && signal.topics.includes('access')) {
      this.epoch++;
      this.data.clear();
      return;
    }
    if (signal.kind === 'ready') {
      this.invalidate(['conversation', 'saved-replies', 'catalog', 'search', 'attachments']);
      return;
    }
    if (signal.kind === 'change')
      this.invalidate([...signal.topics, ...signal.ticketIds.map((id) => `ticket:${id}`)]);
  }

  get state() {
    return { entries: this.data.size, bytes: this.data.byteSize, pending: this.pending.size };
  }
}

export const clientCache = new ClientCache();

export function queryPolicy(path: string) {
  const url = new URL(path, 'http://local');
  if (
    url.origin !== 'http://local' &&
    (typeof window === 'undefined' || url.origin !== window.location.origin)
  )
    return;
  url.searchParams.sort();
  const key = `${url.pathname}?${url.searchParams}`;
  if (url.pathname === '/api/v1/search' || url.pathname === '/api/v1/search/senders')
    return {
      key,
      ttl: 20000,
      tags: ['search', 'conversation', 'attachments', 'catalog', 'receipts'],
    };
  if (url.pathname.startsWith('/api/v1/saved-replies'))
    return { key, ttl: 30000, tags: ['saved-replies', 'attachments', 'catalog'] };
  if (url.pathname === '/api/v1/departments/choices')
    return { key, ttl: 30000, tags: ['catalog', 'inbox'] };
  const ticket = url.pathname.match(
    /^\/api\/v1\/tickets\/([^/]+)\/(messages|history)(?:\/[^/]+)?$/,
  );
  if (ticket) return { key, ttl: 60000, tags: [`ticket:${ticket[1]}`, 'catalog'] };
}
