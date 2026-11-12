import type { Actor } from '../domain/authorization';
import type { RealtimeEnvelope } from '../domain/realtime';
import { AppError, fail } from '../domain/errors';
import { config } from '../infrastructure/config';
import { acquireRealtimeLease } from '../infrastructure/realtime-lease';
import { subscribeRealtime } from '../infrastructure/realtime';
import {
  authorizedUpdate,
  mayReceiveChange,
  refreshStreamActor,
} from '../application/realtime-access';

const encoder = new TextEncoder();

export function sseFrame(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Streams invalidations only. Every new connection triggers an HTTP resync;
 * Last-Event-ID is intentionally not treated as a durable message cursor. */
export async function openRealtime(request: Request, initial: Actor) {
  const origin = request.headers.get('origin'),
    site = request.headers.get('sec-fetch-site');
  if (
    (origin && origin !== config().APP_ORIGIN) ||
    (site && !['same-origin', 'none'].includes(site))
  )
    fail('FORBIDDEN', 403);
  const authenticated = await refreshStreamActor(initial);
  let actor = authenticated.actor,
    expiresAt = authenticated.expiresAt;
  const lease = await acquireRealtimeLease(actor.id, actor.sessionId);
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false,
    flushing = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, RealtimeEnvelope>();

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(flushTimer);
    clearTimeout(heartbeat);
    clearTimeout(lifetime);
    pending.clear();
    unsubscribe?.();
    request.signal.removeEventListener('abort', close);
    void lease.release().catch(() => {});
    try {
      controller?.close();
    } catch {
      /* A cancelled reader is already closed. */
    }
  }

  function send(event: string, data: unknown) {
    if (closed || !controller) return;
    const frame = sseFrame(event, data);
    if ((controller.desiredSize ?? 0) < frame.byteLength) {
      close();
      return;
    }
    try {
      controller.enqueue(frame);
    } catch {
      close();
    }
  }

  function failed(error: unknown) {
    if (error instanceof AppError && error.status === 401) send('auth', {});
    close();
  }

  async function flush() {
    flushTimer = undefined;
    if (closed || flushing || !pending.size) return;
    flushing = true;
    const batch = [...pending.values()];
    pending.clear();
    try {
      const current = await refreshStreamActor(actor);
      actor = current.actor;
      expiresAt = current.expiresAt;
      const update = await authorizedUpdate(
        actor,
        batch.map((event) => event.change),
      );
      if (!closed && update.topics.length) send('change', update);
    } catch (error) {
      failed(error);
    } finally {
      flushing = false;
      if (!closed && pending.size) flushTimer = setTimeout(() => void flush(), 100);
    }
  }

  function scheduleHeartbeat() {
    heartbeat = setTimeout(
      () => void beat(),
      Math.min(15000, Math.max(10, expiresAt.getTime() - Date.now() + 5)),
    );
  }

  async function beat() {
    if (closed) return;
    try {
      const current = await refreshStreamActor(actor);
      actor = current.actor;
      expiresAt = current.expiresAt;
      if (!(await lease.renew())) {
        close();
        return;
      }
      send('heartbeat', {});
      if (!closed) scheduleHeartbeat();
    } catch (error) {
      failed(error);
    }
  }

  try {
    unsubscribe = await subscribeRealtime({
      change: (event) => {
        if (closed || !mayReceiveChange(actor, event.change)) return;
        pending.set(event.id, event);
        if (pending.size > 64) {
          close();
          return;
        }
        if (!flushing && !flushTimer) flushTimer = setTimeout(() => void flush(), 100);
      },
      disconnect: close,
    });
    if (closed || request.signal.aborted) {
      close();
      unsubscribe();
      return new Response(null, { status: 204 });
    }
    const body = new ReadableStream<Uint8Array>(
      {
        start(target) {
          controller = target;
          request.signal.addEventListener('abort', close, { once: true });
          target.enqueue(encoder.encode('retry: 3000\n\n'));
          send('ready', {});
          scheduleHeartbeat();
          lifetime = setTimeout(close, 15 * 60 * 1000);
        },
        cancel: close,
      },
      { highWaterMark: 16384, size: (chunk) => chunk.byteLength },
    );
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}
