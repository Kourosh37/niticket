import { currentActor } from '@/lib/session';
import { reports, departmentChoices } from '@niticket/core/application/administration';
import { notFound } from 'next/navigation';
import { statusNames, priorityNames, digits } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string; from?: string; to?: string }>;
}) {
  const a = await currentActor();
  if (!a.isAdmin && !a.memberships.length) notFound();
  const query = await searchParams;
  const input = {
    departmentId: query.departmentId || undefined,
    from: query.from ? new Date(query.from + 'T00:00:00+03:30').toISOString() : undefined,
    to: query.to ? new Date(query.to + 'T23:59:59+03:30').toISOString() : undefined,
  };
  const [data, departments] = await Promise.all([reports(a, input), departmentChoices(a, true)]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>گزارش‌ها و آمار</h1>
          <p>نمایی از وضعیت درخواست‌ها در محدوده دسترسی شما</p>
        </div>
      </div>
      <form className="surface filters" style={{ marginBottom: 24 }}>
        <Select
          key={query.departmentId ?? ''}
          name="departmentId"
          aria-label="واحد گزارش"
          defaultValue={query.departmentId ?? ''}
          options={[
            { value: '', label: 'همه واحدهای مجاز' },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <div>
          <label htmlFor="from">از تاریخ (میلادی)</label>
          <input id="from" name="from" type="date" dir="ltr" defaultValue={query.from} />
        </div>
        <div>
          <label htmlFor="to">تا تاریخ (میلادی)</label>
          <input id="to" name="to" type="date" dir="ltr" defaultValue={query.to} />
        </div>
        <Button variant="outline">نمایش گزارش</Button>
      </form>
      <div className="stats-grid">
        <div className="stat-card">
          <p className="muted">همه درخواست‌ها</p>
          <strong>{digits(data.total)}</strong>
        </div>
        {data.users !== null && (
          <div className="stat-card">
            <p className="muted">کاربران سامانه</p>
            <strong>{digits(data.users)}</strong>
          </div>
        )}
        {data.departments !== null && (
          <div className="stat-card">
            <p className="muted">واحدهای فعال</p>
            <strong>{digits(data.departments)}</strong>
          </div>
        )}
        <div className="stat-card">
          <p className="muted">اعلان‌های خوانده‌نشده شما</p>
          <strong>{digits(data.unread)}</strong>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <p className="muted">میانگین اولین پاسخ</p>
          <strong>
            {data.timing.firstResponseSeconds === null
              ? '—'
              : digits(Math.round(data.timing.firstResponseSeconds / 60))}
          </strong>
          <small>دقیقه · فقط درخواست‌های پاسخ‌داده‌شده</small>
        </div>
        <div className="stat-card">
          <p className="muted">میانگین زمان حل</p>
          <strong>
            {data.timing.resolutionSeconds === null
              ? '—'
              : digits(Math.round(data.timing.resolutionSeconds / 60))}
          </strong>
          <small>دقیقه · فقط درخواست‌های حل‌شده</small>
        </div>
        <div className="stat-card">
          <p className="muted">درخواست‌های سررسیدگذشته</p>
          <strong>{digits(data.timing.overdue)}</strong>
          <small>در صورت تعیین مهلت رسیدگی</small>
        </div>
      </div>
      <div className="form-grid">
        <section className="surface admin-card">
          <h2>درخواست‌ها بر اساس وضعیت</h2>
          {data.byStatus.map((g) => (
            <div className="report-row" key={g.status}>
              <span>{statusNames[g.status]}</span>
              <div className="report-bar">
                <span style={{ width: `${data.total ? (g._count / data.total) * 100 : 0}%` }} />
              </div>
              <b>{digits(g._count)}</b>
            </div>
          ))}
          {!data.total && <p style={{ marginTop: 15 }}>هنوز داده‌ای برای این بازه وجود ندارد.</p>}
        </section>
        <section className="surface admin-card">
          <h2>توزیع اولویت‌ها</h2>
          {data.byPriority.map((g) => (
            <div className="report-row" key={g.priority}>
              <span>{priorityNames[g.priority]}</span>
              <div className="report-bar">
                <span style={{ width: `${data.total ? (g._count / data.total) * 100 : 0}%` }} />
              </div>
              <b>{digits(g._count)}</b>
            </div>
          ))}
        </section>
      </div>
      <div className="form-grid">
        <section className="surface admin-card">
          <h2>بار کاری کارشناسان</h2>
          {data.byAgent.map((g) => (
            <div className="report-row" key={g.assigneeId ?? 'none'}>
              <span>
                {data.agents.find((a) => a.id === g.assigneeId)?.name ??
                  (g.assigneeId ? 'کارشناس' : 'بدون کارشناس')}
              </span>
              <div className="report-bar">
                <span style={{ width: `${data.total ? (g._count / data.total) * 100 : 0}%` }} />
              </div>
              <b>{digits(g._count)}</b>
            </div>
          ))}
        </section>
        <section className="surface admin-card">
          <h2>درخواست‌ها بر اساس دسته‌بندی</h2>
          {data.byCategory.map((g) => (
            <div className="report-row" key={g.categoryId ?? 'none'}>
              <span>
                {data.categories.find((c) => c.id === g.categoryId)?.name ?? 'بدون دسته‌بندی'}
              </span>
              <div className="report-bar">
                <span style={{ width: `${data.total ? (g._count / data.total) * 100 : 0}%` }} />
              </div>
              <b>{digits(g._count)}</b>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
