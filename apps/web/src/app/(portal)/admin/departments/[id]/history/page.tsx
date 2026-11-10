import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { db } from '@niticket/database';
import { listTickets } from '@niticket/core/application/tickets';
import { TicketList } from '@/components/ticket-list';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/avatar';
import { LiveSearchForm } from '@/components/live-search-form';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string; q?: string }>;
}) {
  const a = await currentActor();
  if (!a.isAdmin) notFound();
  const { id } = await params;
  const query = await searchParams;
  const department = await db.department.findUnique({
    where: { id },
    include: { memberships: { where: { active: true }, include: { user: true } } },
  });
  if (!department) notFound();
  const tickets = await listTickets(a, {
    scope: 'department',
    departmentId: id,
    cursor: query.cursor,
    q: query.q,
  });
  return (
    <>
      <div className="breadcrumb">
        <Link href="/admin/departments">واحدها</Link>
        <span> / </span>
        <span>تاریخچه واحد</span>
      </div>
      <div className="page-heading">
        <div>
          <h1>تاریخچه {department.name}</h1>
          <p>همه درخواست‌ها و روند رسیدگی این واحد · دسترسی مشاهده برای مدیر سامانه</p>
        </div>
      </div>
      {department.memberships.map((m) => (
        <div key={m.id} className="surface admin-card responsible-person">
          <Avatar name={m.user.name} image={m.user.image} />
          <div>
            <strong>{m.user.name}</strong>
            <p>
              مسئول واحد · <bdi>{m.user.phoneNumber?.replace('+98', '0')}</bdi>
            </p>
          </div>
        </div>
      ))}
      <section className="surface">
        <LiveSearchForm className="filters">
          <input
            type="search"
            enterKeyHint="search"
            name="q"
            aria-label="جستجو در تاریخچه واحد"
            defaultValue={query.q}
            placeholder="جستجوی موضوع درخواست…"
            maxLength={100}
          />
        </LiveSearchForm>
        <TicketList
          tickets={tickets.items}
          canCreate={false}
          showHistory
          emptyText="هنوز درخواستی برای این واحد ثبت نشده است."
        />
        {tickets.nextCursor && (
          <div className="pagination">
            <Button asChild variant="outline">
              <Link
                href={`?cursor=${tickets.nextCursor}${query.q ? '&q=' + encodeURIComponent(query.q) : ''}`}
              >
                درخواست‌های قبلی
              </Link>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
