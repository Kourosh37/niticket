'use client';

import { useEffect } from 'react';
import { checkSession } from '@/lib/utils';

export function SessionGuard() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function check() {
      if (stopped || checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch('/api/v1/session', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (stopped) return;
        checkSession(response);
        if (!response.ok) return;
        const result = await response.json();
        if (stopped) return;
        if (!Number.isFinite(result.data?.expiresInMs)) return;
        clearTimeout(expiry);
        expiry = setTimeout(
          () => void check(),
          Math.min(2147483647, Math.max(1000, result.data.expiresInMs + 100)),
        );
      } catch {
        /* Network outages are retried without logging the user out. */
      } finally {
        checking = false;
      }
    }

    void check();
    const interval = setInterval(() => void check(), 30000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(interval);
      clearTimeout(expiry);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return null;
}
