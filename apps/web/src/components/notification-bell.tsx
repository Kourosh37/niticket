'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { request, digits } from '@/lib/utils';

export function NotificationBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true,
      inFlight = false,
      queued = false;
    const abort = new AbortController();
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      void request<{ unreadCount: number }>('/api/v1/notifications/count', { signal: abort.signal })
        .then((data) => {
          if (active) setCount(data.unreadCount);
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
          if (active && queued) {
            queued = false;
            update();
          }
        });
    };
    update();
    const timer = setInterval(update, 20000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('notifications:changed', update);
    return () => {
      active = false;
      abort.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('notifications:changed', update);
    };
  }, []);
  return (
    <Link
      href="/notifications"
      className="icon-link notification-bell"
      aria-label={count ? `${digits(count)} اعلان خوانده‌نشده` : 'اعلان‌ها'}
    >
      <Bell size={20} />
      {count > 0 && (
        <span className="notification-count" aria-hidden="true">
          {digits(Math.min(count, 99))}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {count ? `${digits(count)} اعلان خوانده‌نشده` : ''}
      </span>
    </Link>
  );
}
