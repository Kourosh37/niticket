'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { request } from '@/lib/utils';

export function InboxRefresh() {
  const router = useRouter();
  useEffect(() => {
    let active = true,
      checking = false,
      revision: string | undefined;
    const abort = new AbortController();
    const refresh = async () => {
      if (
        checking ||
        document.visibilityState !== 'visible' ||
        document.querySelector('[data-search-active="true"]') ||
        document.activeElement?.matches('input, select, textarea')
      )
        return;
      checking = true;
      try {
        const result = await request<{ revision: string }>('/api/v1/inbox/revision', {
          signal: abort.signal,
        });
        if (active && revision !== result.revision) {
          revision = result.revision;
          router.refresh();
        }
      } catch {
        /* Retry on the next visible poll. */
      } finally {
        checking = false;
      }
    };
    const focus = () => {
      revision = undefined;
      void refresh();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return null;
}
