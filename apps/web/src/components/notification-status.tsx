'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, ChevronLeft, MessageCircle } from 'lucide-react';
import { digits, request } from '@/lib/utils';
import { realtime, matchesSignal } from '@/lib/realtime-client';

const UnreadCount = createContext(0);

/** Shared unread state with SSE invalidations and a bounded HTTP recovery poll. */
export function NotificationStatus({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const path = usePathname();
  useEffect(() => {
    let active = true,
      inFlight = false,
      queued = false;
    const abort = new AbortController();
    let pushed: ReturnType<typeof setTimeout> | undefined;
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
    let timer: ReturnType<typeof setInterval>;
    const interval = () => {
      clearInterval(timer);
      timer = setInterval(update, realtime.live ? 60000 : 20000);
    };
    const unsubscribe = realtime.subscribe((signal) => {
      if (signal.kind === 'state') interval();
      if (matchesSignal(signal, ['notifications']) && !pushed)
        pushed = setTimeout(() => {
          pushed = undefined;
          update();
        }, 750);
    });
    interval();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('notifications:changed', update);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    return () => {
      active = false;
      abort.abort();
      clearInterval(timer);
      clearTimeout(pushed);
      unsubscribe();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('notifications:changed', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
    };
  }, [path]);
  return <UnreadCount.Provider value={count}>{children}</UnreadCount.Provider>;
}

export function UnreadBadge() {
  const count = useContext(UnreadCount);
  return count > 0 ? (
    <span className="dock-unread-count" aria-hidden="true" dir="ltr">
      {count > 99 ? `${digits(99)}+` : digits(count)}
    </span>
  ) : null;
}

export function ConversationNavigation() {
  const count = useContext(UnreadCount);
  return (
    <>
      <span className="dock-icon">
        <MessageCircle size={23} />
        <UnreadBadge />
      </span>
      <span>گفتگوها</span>
      <span className="sr-only" role="status">
        {count ? `${digits(count)} اعلان خوانده‌نشده` : ''}
      </span>
    </>
  );
}

export function UnreadInboxNotice() {
  const count = useContext(UnreadCount);
  if (!count) return null;
  return (
    <Link href="/notifications" className="inbox-unread-notice">
      <Bell size={19} />
      <span>{digits(count)} اعلان جدید دارید</span>
      <span>
        مشاهده <ChevronLeft size={16} />
      </span>
    </Link>
  );
}
