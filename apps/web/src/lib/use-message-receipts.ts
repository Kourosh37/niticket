'use client';

import { useEffect, useRef, useState } from 'react';
import { request } from './utils';
import { realtime, matchesSignal } from './realtime-client';

function remember(set: Set<string>, ids: string[]) {
  for (const id of ids) set.add(id);
  while (set.size > 500) set.delete(set.values().next().value!);
}

/** Only visible incoming messages are acknowledged; receipt polling never reloads chat history. */
export function useMessageReceipts(
  ticketId: string,
  incoming: string[],
  outgoing: string[],
  enabled: boolean,
) {
  const acknowledged = useRef(new Set<string>()),
    known = useRef(new Set<string>());
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const incomingKey = incoming.join(','),
    outgoingKey = outgoing.join(',');
  useEffect(() => {
    if (!enabled || !incomingKey) return;
    const ids = incomingKey.split(','),
      abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      inFlight = false;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'visible' || !document.hasFocus() || inFlight) return;
      const pending = ids.filter((id) => !acknowledged.current.has(id));
      if (!pending.length) return;
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
        inFlight = true;
        void request<{ notificationsRead: number }>(`/api/v1/tickets/${ticketId}/read`, {
          method: 'POST',
          signal: abort.signal,
          body: JSON.stringify({ messageIds: pending }),
        })
          .then((result) => {
            // The server may commit just before a visibility change aborts the
            // request. Publish completed notification changes independently.
            if (result.notificationsRead) window.dispatchEvent(new Event('notifications:changed'));
            if (!abort.signal.aborted) remember(acknowledged.current, pending);
          })
          .catch(() => {
            if (!abort.signal.aborted) timer = setTimeout(schedule, 4000);
          })
          .finally(() => {
            inFlight = false;
          });
      }, 450);
    };
    schedule();
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      abort.abort();
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [ticketId, incomingKey, enabled]);

  useEffect(() => {
    if (!enabled || !outgoingKey) return;
    const ids = outgoingKey.split(','),
      abort = new AbortController();
    let inFlight = false;
    let queued = false;
    const update = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      if (inFlight) {
        queued = true;
        return;
      }
      const pending = ids.filter((id) => !known.current.has(id));
      if (!pending.length) return;
      inFlight = true;
      const params = new URLSearchParams({ ids: pending.join(',') });
      void request<{ items: { id: string; readAt: string | null }[] }>(
        `/api/v1/tickets/${ticketId}/receipts?${params}`,
        { signal: abort.signal },
      )
        .then(({ items }) => {
          if (abort.signal.aborted) return;
          const fresh = items
            .filter((item) => item.readAt && !known.current.has(item.id))
            .map((item) => item.id);
          if (fresh.length) {
            remember(known.current, fresh);
            setSeen(new Set(known.current));
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
          if (queued && !abort.signal.aborted) {
            queued = false;
            update();
          }
        });
    };
    const initial = setTimeout(update, 250);
    let timer: ReturnType<typeof setInterval>;
    const interval = () => {
      clearInterval(timer);
      timer = setInterval(update, realtime.live ? 60000 : 5000);
    };
    const unsubscribe = realtime.subscribe((signal) => {
      if (signal.kind === 'state') interval();
      if (matchesSignal(signal, ['receipts'], ticketId)) update();
    });
    interval();
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      unsubscribe();
      abort.abort();
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [ticketId, outgoingKey, enabled]);
  return seen;
}
