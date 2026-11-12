'use client';

import { useEffect, useRef } from 'react';
import { matchesSignal, realtime, type Topic } from './realtime-client';

/** Serializes HTTP reconciliation, retaining invalidations received during a fetch.
 * False means temporarily busy; retry without dropping the invalidation. */
export function useRealtimeSync(
  work: () => Promise<unknown> | boolean | void,
  selected: readonly Topic[],
  {
    ticketId,
    enabled = true,
    fallbackMs = 5000,
    liveMs = 60000,
    initial = true,
  }: {
    ticketId?: string;
    enabled?: boolean;
    fallbackMs?: number;
    liveMs?: number;
    initial?: boolean;
  } = {},
) {
  const latest = useRef(work);
  useEffect(() => {
    latest.current = work;
  }, [work]);
  const key = selected.join(',');
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      running = false,
      dirty = false,
      lastStart = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval>;
    const topics = key.split(',') as Topic[];
    const run = async () => {
      timer = undefined;
      if (stopped || running || !dirty || document.visibilityState === 'hidden') return;
      running = true;
      dirty = false;
      lastStart = Date.now();
      try {
        if ((await latest.current()) === false) dirty = true;
      } catch {
        /* Periodic reconciliation recovers HTTP/network failures. */
      } finally {
        running = false;
        if (!stopped && dirty) schedule();
      }
    };
    const schedule = () => {
      dirty = true;
      if (!stopped && !running && !timer)
        timer = setTimeout(() => void run(), Math.max(0, 750 - (Date.now() - lastStart)));
    };
    const interval = () => {
      clearInterval(poll);
      poll = setInterval(schedule, realtime.live ? liveMs : fallbackMs);
    };
    const unsubscribe = realtime.subscribe((signal) => {
      if (signal.kind === 'state') interval();
      if (matchesSignal(signal, topics, ticketId)) schedule();
    });
    interval();
    if (initial) schedule();
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      unsubscribe();
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [key, ticketId, enabled, fallbackMs, liveMs, initial]);
}
