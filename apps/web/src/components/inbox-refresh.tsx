'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { request } from '@/lib/utils';
import { useRealtimeSync } from '@/lib/use-realtime-sync';

export function InboxRefresh() {
  const router = useRouter();
  const revision = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);
  useRealtimeSync(async () => {
    if (
      document.querySelector('[data-search-active="true"]') ||
      document.activeElement?.matches('input, select, textarea')
    )
      return false;
    const result = await request<{ revision: string }>('/api/v1/inbox/revision', {
      signal: abort.current?.signal,
    });
    if (!abort.current?.signal.aborted && revision.current !== result.revision) {
      revision.current = result.revision;
      router.refresh();
    }
  }, ['inbox']);
  return null;
}
