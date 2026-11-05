import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { currentActor } from '@/lib/session';
import { auditLogs } from '@niticket/core/application/administration';
import { dateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const names: Record<string, string> = {
  AUTH_LOGIN: 'ورود موفق',
  AUTH_LOGIN_FAILED: 'تلاش ناموفق ورود',
  ADMIN_BOOTSTRAPPED: 'ایجاد مدیر اولیه',
  USER_CREATED: 'ایجاد حساب کاربری',
  USER_ACCESS_CHANGED: 'تغییر دسترسی کاربر',
  DEPARTMENT_CREATED: 'ایجاد واحد',
  DEPARTMENT_UPDATED: 'ویرایش واحد',
  MEMBERSHIP_CHANGED: 'تغییر عضویت',
  CATEGORY_CHANGED: 'تغییر دسته‌بندی',
  REAUTHENTICATED: 'تأیید مجدد هویت',
  TICKET_CREATED: 'ثبت درخواست',
  PUBLIC_REPLY: 'پاسخ به درخواست',
  INTERNAL_NOTE: 'یادداشت داخلی',
  STATUS_CHANGED: 'تغییر وضعیت',
  ASSIGNED: 'ارجاع به کارشناس',
  TRANSFERRED: 'انتقال درخواست',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const a = await currentActor();
  if (!a.isAdmin) notFound();
  const { cursor } = await searchParams;
  const data = await auditLogs(a, cursor);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>رویدادهای امنیتی</h1>
          <p>سابقه ثبت‌شده عملیات و تغییرات سامانه</p>
        </div>
        <ShieldCheck size={25} />
      </div>
      <section className="surface">
        {data.items.map((event) => (
          <div key={event.id} className="notification-row">
            <span>
              <ShieldCheck size={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong>{names[event.action] ?? 'رویداد سامانه'}</strong>
              <time>{dateTime(event.createdAt)}</time>
              <p className="muted" style={{ fontSize: 9, overflowWrap: 'anywhere' }}>
                شناسه عامل: <bdi dir="ltr">{event.actorId ?? 'سامانه'}</bdi>
              </p>
            </div>
          </div>
        ))}
        {data.nextCursor && (
          <div className="pagination">
            <Button asChild variant="outline">
              <Link href={`/admin/audit?cursor=${data.nextCursor}`}>رویدادهای قبلی</Link>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
