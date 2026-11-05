import Link from 'next/link';
import { Search, Plus } from 'lucide-react';
import { currentActor } from '@/lib/session';
import { listTickets } from '@niticket/core/application/tickets';
import { listDepartments } from '@niticket/core/application/administration';
import { TicketList } from '@/components/ticket-list';
import { Button } from '@/components/ui/button';
import { statusNames } from '@/lib/utils';
import { redirect } from 'next/navigation';
import { userRole } from '@niticket/core/domain/authorization';

export async function TicketPage({
  searchParams,
  workspace = false,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
  workspace?: boolean;
}) {
  const actor = await currentActor();
  if (actor.isAdmin) redirect('/admin/departments');
  if (!workspace && userRole(actor) === 'STAFF') redirect('/workspace');
  const query = await searchParams;
  const filters = { ...query, scope: workspace ? 'department' : 'mine' };
  const [result, departments] = await Promise.all([
    listTickets(actor, filters),
    listDepartments(actor, workspace),
  ]);
  const base = workspace ? '/workspace' : '/tickets';
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            {workspace ? 'فضای پاسخ‌گویی همکاران' : 'ارتباط شما با دانشگاه'}
          </div>
          <h1>{workspace ? 'میز کار واحد' : 'درخواست‌های من'}</h1>
          <p>
            {workspace
              ? 'درخواست‌های واحدهای مجاز خود را بررسی و پیگیری کنید.'
              : 'وضعیت همه درخواست‌های خود را در یک نگاه دنبال کنید.'}
          </p>
        </div>
        {!workspace && (
          <Button asChild>
            <Link href="/tickets/new">
              <Plus size={18} /> درخواست جدید
            </Link>
          </Button>
        )}
      </div>
      <section className="surface">
        <form action={base} className="filters">
          <input type="hidden" name="scope" value={filters.scope} />
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="جستجوی موضوع درخواست"
              name="q"
              defaultValue={query.q}
              placeholder="جستجو در درخواست‌ها…"
              maxLength={100}
            />
          </div>
          <select aria-label="وضعیت درخواست" name="status" defaultValue={query.status ?? ''}>
            <option value="">همه وضعیت‌ها</option>
            {Object.entries(statusNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="واحد پاسخ‌گو"
            name="departmentId"
            defaultValue={query.departmentId ?? ''}
          >
            <option value="">همه واحدها</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            اعمال فیلتر
          </Button>
        </form>
        <TicketList
          canCreate={!workspace}
          tickets={result.items}
          emptyText={
            query.q || query.status
              ? 'درخواستی با این فیلترها پیدا نشد.'
              : workspace
                ? 'درخواستی در این صف وجود ندارد.'
                : undefined
          }
        />
        {(result.nextCursor || query.cursor) && (
          <div className="pagination">
            {query.cursor && (
              <Button asChild variant="outline">
                <Link href={base}>بازگشت به ابتدا</Link>
              </Button>
            )}
            {result.nextCursor && (
              <Button asChild variant="outline">
                <Link
                  href={`${base}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined)), cursor: result.nextCursor })}`}
                >
                  صفحه بعد
                </Link>
              </Button>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export default TicketPage;
