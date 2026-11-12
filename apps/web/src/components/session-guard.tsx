'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { checkSession } from '@/lib/utils';

export function SessionGuard() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let checking = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function check() {
      if (stopped || checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch('/api/auth/get-session', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (stopped) return;
        checkSession(response);
        if (!response.ok) return;
        const result = await response.json();
        if (stopped) return;
        if (!result?.session) {
          router.replace('/login');
          return;
        }
        const expiresInMs = new Date(result.session.expiresAt).getTime() - Date.now();
        if (!Number.isFinite(expiresInMs)) return;
        clearTimeout(expiry);
        expiry = setTimeout(
          () => void check(),
          Math.min(2147483647, Math.max(1000, expiresInMs + 100)),
        );
      } catch {
        /* Network outages are retried without logging the user out. */
      } finally {
        checking = false;
      }
    }

    void check();
    const invalid = () => router.replace('/login');
    const interval = setInterval(() => void check(), 30000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('session:check', check);
    window.addEventListener('session:invalid', invalid);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(interval);
      clearTimeout(expiry);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('session:check', check);
      window.removeEventListener('session:invalid', invalid);
      document.removeEventListener('visibilitychange', check);
    };
  }, [router]);
  return null;
}
