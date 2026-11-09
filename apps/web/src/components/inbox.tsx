import Link from 'next/link';
import { Building2, ChevronLeft, MessageCircle } from 'lucide-react';
import type { Actor } from '@niticket/core/domain/authorization';
import { userRole } from '@niticket/core/domain/authorization';
import { listTickets } from '@niticket/core/application/tickets';
import { departmentChoices } from '@niticket/core/application/administration';
import { Avatar } from './avatar';
import { Button } from './ui/button';
import { InboxRefresh } from './inbox-refresh';
import { UnreadInboxNotice } from './notification-status';
import { MessageSearch } from './message-search';
import { LiveSearchForm } from './live-search-form';
import { messageSearchSchema } from '@niticket/core/application/message-search';
import { searchFilterFields } from '@/lib/search';
import { date } from '@/lib/utils';
import { needsReply, ticketState } from '@/lib/ticket-ui';

export async function Inbox({
  actor,
  query = {},
  base = '/',
}: {
  actor: Actor;
  query?: Record<string, string | undefined>;
  base?: string;
}) {
  const staff = userRole(actor) === 'STAFF';
  const parsed = messageSearchSchema.safeParse(
    Object.fromEntries(
      searchFilterFields
        .filter((key) => typeof query[key] === 'string' && query[key] !== '')
        .map((key) => [key, query[key]]),
    ),
  );
  const initialSearch = parsed.success ? parsed.data : {};
  const view =
    query.view === 'done'
      ? 'answered'
      : ['all', 'action', 'answered'].includes(query.view ?? '')
        ? query.view!
        : staff
          ? 'action'
          : 'all';
  const filters = {
    scope: staff ? 'department' : 'mine',
    view,
    departmentId: query.departmentId || undefined,
    cursor: query.cursor || undefined,
  };
  const [result, departments] = await Promise.all([
    listTickets(actor, filters),
    departmentChoices(actor, staff),
  ]);

  function href(changes: Record<string, string>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      view,
      q: query.q,
      departmentId: query.departmentId,
      ...changes,
    })) {
      if (value) params.set(key, value);
    }
    return `${base}?${params}`;
  }

  const filtered = !!query.departmentId || view !== 'all';
  return (
    <div className="easy-inbox">
      <InboxRefresh />
      <h1 className="sr-only">{staff ? 'گفتگوهای واحد' : 'گفتگوهای من'}</h1>
      <UnreadInboxNotice />
      <section className="inbox-panel" aria-label="فهرست گفتگوها">
        <nav className="inbox-tabs" aria-label="نمایش گفتگوها">
          {(staff
            ? [
                ['action', 'پیام‌های جدید'],
                ['answered', 'پاسخ داده‌شده'],
                ['all', 'همه گفتگوها'],
              ]
            : [
                ['all', 'همه گفتگوها'],
                ['action', 'پاسخ‌های واحد'],
              ]
          ).map(([key, label]) => (
            <Link
              key={key}
              href={href({ view: key })}
              aria-current={view === key ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        {departments.length > 1 && (
          <LiveSearchForm
            action={base}
            className="inbox-department-filter"
            preserve={searchFilterFields.filter((key) => key !== 'departmentId')}
          >
            <input type="hidden" name="view" value={view} />
            <select
              name="departmentId"
              aria-label="واحد پاسخ‌گو"
              defaultValue={query.departmentId ?? ''}
            >
              <option value="">همه واحدها</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </LiveSearchForm>
        )}
        <MessageSearch
          key={JSON.stringify(initialSearch)}
          actorId={actor.id}
          privateAllowed={staff}
          inline
          autoFocus={query.search === '1'}
          returnPath={`${base}?view=${view}`}
          initial={initialSearch}
        >
          {result.items.length ? (
            <div className="inbox-threads">
              {result.items.map((ticket) => {
                const action = needsReply(ticket.status, staff);
                const preview = ticket.messages[0];
                return (
                  <Link
                    className={`inbox-thread ${action ? 'thread-action' : ''}`}
                    key={ticket.id}
                    href={`/tickets/${ticket.id}`}
                  >
                    <div className="thread-avatar">
                      {staff ? (
                        <Avatar name={ticket.creator.name} image={ticket.creator.image} />
                      ) : (
                        <Building2 size={25} />
                      )}
                      {action && <span className="thread-dot" aria-hidden="true" />}
                    </div>
                    <div className="thread-content">
                      <div className="thread-top">
                        <strong>{staff ? ticket.creator.name : ticket.department.name}</strong>
                        <time dateTime={new Date(ticket.lastActivityAt).toISOString()}>
                          {date(ticket.lastActivityAt)}
                        </time>
                      </div>
                      <p className="messenger-thread-preview">
                        {preview
                          ? `${preview.senderId === actor.id ? 'شما: ' : ''}${preview.body}`
                          : 'هنوز پیامی نفرستاده‌اید.'}
                      </p>
                      <span className={`thread-state ${action ? 'state-action' : ''}`}>
                        {ticketState(ticket.status, staff)}
                      </span>
                      {staff && <small className="thread-unit">{ticket.department.name}</small>}
                    </div>
                    <ChevronLeft size={20} className="thread-chevron" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="inbox-empty">
              <span>
                <MessageCircle size={38} />
              </span>
              <h2>
                {filtered
                  ? 'گفتگویی در این بخش نیست'
                  : staff
                    ? 'هنوز پیامی برای واحد شما نیامده'
                    : 'اولین پیامتان را بفرستید'}
              </h2>
              <p>
                {filtered
                  ? 'می‌توانید همه گفتگوها را ببینید.'
                  : staff
                    ? 'درخواست‌های جدید همین‌جا نمایش داده می‌شوند.'
                    : 'واحد موردنظر را انتخاب کنید و بنویسید چه کمکی نیاز دارید.'}
              </p>
              {filtered ? (
                <Button asChild variant="outline">
                  <Link href={href({ view: 'all', q: '', departmentId: '' })}>همه گفتگوها</Link>
                </Button>
              ) : (
                !staff && (
                  <Button asChild>
                    <Link href="/tickets/new">
                      شروع گفتگو <ChevronLeft size={18} />
                    </Link>
                  </Button>
                )
              )}
            </div>
          )}
          {(result.nextCursor || query.cursor) && (
            <div className="inbox-pagination">
              {query.cursor && (
                <Button asChild variant="ghost">
                  <Link href={href({ cursor: '' })}>تازه‌ترین گفتگوها</Link>
                </Button>
              )}
              {result.nextCursor && (
                <Button asChild variant="outline">
                  <Link href={href({ cursor: result.nextCursor })}>گفتگوهای بیشتر</Link>
                </Button>
              )}
            </div>
          )}
        </MessageSearch>
      </section>
      {!staff && <p className="inbox-footnote">برای پیام دادن، روی نام واحد بزنید.</p>}
    </div>
  );
}
