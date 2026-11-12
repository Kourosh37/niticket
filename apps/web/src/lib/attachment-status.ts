import { useEffect, useState } from 'react';
import type { AttachmentInfo } from '@/components/attachment-preview';
import { request } from './utils';
import { realtime, matchesSignal } from './realtime-client';

type Listener = (file: AttachmentInfo) => void;
const listeners = new Map<string, Set<Listener>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let active: AbortController | undefined;
let unsubscribe: (() => void) | undefined;
let queued = false;

function schedule(delay = 5000) {
  if (listeners.size && !timer && !active) timer = setTimeout(() => void poll(), delay);
}

async function poll() {
  timer = undefined;
  if (!listeners.size) return;
  if (document.visibilityState !== 'visible') {
    schedule();
    return;
  }
  const controller = new AbortController();
  active = controller;
  const ids = [...listeners.keys()].slice(0, 50);
  try {
    const files = await request<AttachmentInfo[]>(`/api/v1/uploads/statuses?ids=${ids.join(',')}`, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    for (const file of files) {
      for (const notify of listeners.get(file.id) ?? []) notify(file);
      if (file.scanStatus === 'CLEAN' || file.scanStatus === 'REJECTED') listeners.delete(file.id);
    }
  } catch {
    /* Transient failures are retried while pending previews remain mounted. */
  } finally {
    if (active === controller) active = undefined;
    if (!controller.signal.aborted) {
      // Rotate batches so a long history cannot starve later attachments.
      for (const id of ids) {
        const current = listeners.get(id);
        if (current) {
          listeners.delete(id);
          listeners.set(id, current);
        }
      }
      schedule(queued ? 100 : listeners.size > 50 ? 1000 : realtime.live ? 60000 : 5000);
      queued = false;
    }
  }
}

export function useAttachmentStatus(file: AttachmentInfo) {
  const [updated, setUpdated] = useState<AttachmentInfo | null>(null);
  useEffect(() => {
    if (!['PENDING', 'QUARANTINED'].includes(file.scanStatus)) return;
    const current = listeners.get(file.id) ?? new Set<Listener>();
    current.add(setUpdated);
    listeners.set(file.id, current);
    if (!unsubscribe)
      unsubscribe = realtime.subscribe((signal) => {
        if (!matchesSignal(signal, ['attachments'])) return;
        if (active) {
          queued = true;
          return;
        }
        clearTimeout(timer);
        timer = undefined;
        schedule(100);
      });
    schedule(100);
    return () => {
      current.delete(setUpdated);
      if (!current.size && listeners.get(file.id) === current) listeners.delete(file.id);
      if (!listeners.size) {
        clearTimeout(timer);
        timer = undefined;
        active?.abort();
        active = undefined;
        unsubscribe?.();
        unsubscribe = undefined;
        queued = false;
      }
    };
  }, [file.id, file.scanStatus]);
  return updated?.id === file.id && ['PENDING', 'QUARANTINED'].includes(file.scanStatus)
    ? updated
    : file;
}
