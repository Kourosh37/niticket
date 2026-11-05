'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { request, digits } from '@/lib/utils';

export function NotificationBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      const current = ++revision;
      void request<{ unreadCount: number }>('/api/v1/notifications')
        .then((data) => {
          if (active && current === revision) setCount(data.unreadCount);
        })
        .catch(() => {});
    };
    update();
    const timer = setInterval(update, 20000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('notifications:changed', update);
    return () => {
      active = false;
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
