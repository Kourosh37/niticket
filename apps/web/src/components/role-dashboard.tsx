import Link from 'next/link';
import { Plus, Building2, Users, Ticket, Clock3, CheckCheck, ArrowUpLeft } from 'lucide-react';
import type { Actor } from '@niticket/core/domain/authorization';
import { reports, listDepartments } from '@niticket/core/application/administration';
import { listTickets } from '@niticket/core/application/tickets';
import { digits } from '@/lib/utils';
import { Button } from './ui/button';
import { TicketList } from './ticket-list';
import { Avatar } from './avatar';

export async function RoleDashboard({ actor }: { actor: Actor }) {
  const [report, departments] = await Promise.all([
    reports(actor),
    listDepartments(actor, true, { limit: actor.isAdmin ? 6 : 1000 }),
  ]);
  const open = report.pendingReplies;
  if (actor.isAdmin)
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span /> مدیریت سامانه
            </div>
            <h1>نمای کلی سامانه</h1>
            <p>واحدها، مسئولان و کاربران دانشگاه را از اینجا مدیریت کنید.</p>
          </div>
          <Button asChild>
            <Link href="/admin/departments?new=1">
              <Plus size={18} /> واحد جدید
            </Link>
          </Button>
        </div>
        <div className="stats-grid">
          {[
            { name: 'کاربران سامانه', value: report.users ?? 0, icon: Users },
            { name: 'واحدهای فعال', value: report.departments ?? 0, icon: Building2 },
            { name: 'همه درخواست‌ها', value: report.total, icon: Ticket },
            { name: 'در حال پیگیری', value: open, icon: Clock3 },
          ].map(({ name, value, icon: Icon }) => (
            <article className="stat-card" key={name}>
              <div className="stat-top">
                <span>{name}</span>
                <span className="stat-icon green">
                  <Icon size={20} />
                </span>
              </div>
              <strong>{digits(value)}</strong>
            </article>
          ))}
        </div>
        <section className="surface">
          <div className="section-heading">
            <div>
              <h2>واحدهای دانشگاه</h2>
              <p>مشاهده تاریخچه و اطلاعات مسئول هر واحد</p>
            </div>
            <Link href="/admin/departments" className="text-link">
              مدیریت واحدها <ArrowUpLeft size={16} />
            </Link>
          </div>
          {departments.length ? (
            <div className="unit-cards">
              {departments.map((d) => (
                <Link
                  className="unit-overview-card"
                  href={`/admin/departments/${d.id}/history`}
                  prefetch={false}
                  key={d.id}
                >
                  <div className="unit-overview-heading">
                    <Building2 size={20} />
                    <h3>{d.name}</h3>
                    <ArrowUpLeft size={16} />
                  </div>
                  <p>{d.description || 'مشاهده تاریخچه درخواست‌های این واحد'}</p>
                  {d.memberships[0] && (
                    <div className="responsible-person">
                      <Avatar
                        name={d.memberships[0].user.name}
                        image={d.memberships[0].user.image}
                      />
                      <span>
                        {d.memberships[0].user.name}
                        <small>مسئول واحد</small>
                      </span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h3>اولین واحد را ایجاد کنید</h3>
              <p>اطلاعات واحد و حساب مسئول آن را در یک فرم ثبت کنید.</p>
              <Button asChild>
                <Link href="/admin/departments?new=1">ایجاد واحد</Link>
              </Button>
            </div>
          )}
        </section>
      </>
    );
  const recent = await listTickets(actor, { scope: 'department', limit: 8 });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> پنل مسئول واحد
          </div>
          <h1>{departments.map((d) => d.name).join('، ') || 'میز کار واحد'}</h1>
          <p>درخواست‌های کاربران را پاسخ دهید و روند رسیدگی را ثبت کنید.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/workspace">همه درخواست‌های واحد</Link>
        </Button>
      </div>
      <div className="stats-grid">
        {[
          { label: 'همه درخواست‌ها', count: report.total, icon: Ticket },
          { label: 'در حال پیگیری', count: open, icon: Clock3 },
          {
            label: 'منتظر پاسخ کاربر',
            count: report.answeredReplies,
            icon: Users,
          },
          {
            label: 'حل‌شده',
            count: report.byStatus
              .filter((g) => ['RESOLVED', 'CLOSED'].includes(g.status))
              .reduce((s, g) => s + g._count, 0),
            icon: CheckCheck,
          },
        ].map(({ label, count, icon: Icon }) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon green">
                <Icon size={20} />
              </span>
            </div>
            <strong>{digits(count)}</strong>
          </article>
        ))}
      </div>
      <section className="surface">
        <div className="section-heading">
          <div>
            <h2>آخرین درخواست‌های واحد</h2>
            <p>برای پاسخ، تغییر وضعیت یا مشاهده تاریخچه، درخواست را باز کنید.</p>
          </div>
        </div>
        <TicketList
          tickets={recent.items}
          canCreate={false}
          emptyText="هنوز درخواستی برای این واحد ثبت نشده است."
        />
      </section>
    </>
  );
}
