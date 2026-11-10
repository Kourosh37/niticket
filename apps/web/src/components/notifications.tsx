'use client';

import Link from 'next/link';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { request, dateTime } from '@/lib/utils';
import { Button } from './ui/button';
import type { notifications } from '@niticket/core/application/administration';

export function Notifications({
  data,
  replyRequired = false,
}: {
  data: Awaited<ReturnType<typeof notifications>>;
  replyRequired?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function read(id?: string, refresh = true) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await request('/api/v1/notifications', { method: 'PATCH', body: JSON.stringify({ id }) });
      window.dispatchEvent(new Event('notifications:changed'));
      if (refresh && window.location.pathname === '/notifications') router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ذخیره انجام نشد.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>اعلان‌ها</h1>
          <p>
            {replyRequired
              ? 'اعلان هر گفتگو پس از ارسال پاسخ به دانشجو خوانده می‌شود.'
              : 'تازه‌ترین خبرها از روند پیگیری درخواست‌های شما'}
          </p>
        </div>
        {!replyRequired && (
          <Button variant="outline" disabled={busy} onClick={() => read()}>
            <CheckCheck size={17} /> خواندن همه
          </Button>
        )}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <section className="surface">
        {data.items.length ? (
          data.items.map((n) => (
            <article key={n.id} className={`notification-row ${!n.readAt ? 'unread' : ''}`}>
              <span>
                <Bell size={20} />
              </span>
              <div>
                {n.ticketId ? (
                  <Link
                    href={`/tickets/${n.ticketId}${n.messageId ? `?message=${n.messageId}` : ''}`}
                  >
                    <strong>{n.title}</strong>
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                <time>{dateTime(n.createdAt)}</time>
              </div>
              {!n.readAt && !replyRequired && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => read(n.id)}>
                  خوانده شد
                </Button>
              )}
            </article>
          ))
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Bell size={28} />
            </span>
            <h3>همه‌چیز را دنبال کرده‌اید</h3>
            <p>اعلان‌های جدید اینجا نمایش داده می‌شوند.</p>
          </div>
        )}
        {data.nextCursor && (
          <div className="pagination">
            <Button asChild variant="outline">
              <Link href={`/notifications?cursor=${data.nextCursor}`}>اعلان‌های قبلی</Link>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
