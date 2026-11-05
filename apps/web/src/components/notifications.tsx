'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { request, dateTime } from '@/lib/utils';
import { Button } from './ui/button';
import type { notifications } from '@niticket/core/application/administration';

export function Notifications({ data }: { data: Awaited<ReturnType<typeof notifications>> }) {
  const router = useRouter();
  const [error, setError] = useState('');

  async function read(id?: string) {
    try {
      await request('/api/v1/notifications', { method: 'PATCH', body: JSON.stringify({ id }) });
      window.dispatchEvent(new Event('notifications:changed'));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ذخیره انجام نشد.');
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>اعلان‌ها</h1>
          <p>تازه‌ترین خبرها از روند پیگیری درخواست‌های شما</p>
        </div>
        <Button variant="outline" onClick={() => read()}>
          <CheckCheck size={17} /> خواندن همه
        </Button>
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
                  <Link href={`/tickets/${n.ticketId}`} onClick={() => void read(n.id)}>
                    <strong>{n.title}</strong>
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                <time>{dateTime(n.createdAt)}</time>
              </div>
              {!n.readAt && (
                <Button variant="ghost" size="sm" onClick={() => read(n.id)}>
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
