import Link from 'next/link';
import { ArrowUpLeft, Inbox, MessageSquare } from 'lucide-react';
import { Status } from './status';
import { date, priorityNames } from '@/lib/utils';
import { ticketNumber, type TicketSummary } from '@niticket/core/application/tickets';
import { Button } from './ui/button';

export function TicketList({
  tickets,
  emptyText = 'هنوز درخواستی ثبت نکرده‌اید.',
  canCreate = true,
}: {
  tickets: TicketSummary[];
  emptyText?: string;
  canCreate?: boolean;
}) {
  if (!tickets.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Inbox size={30} />
        </span>
        <h3>{emptyText}</h3>
        <p>
          {canCreate
            ? 'هر زمان به کمک نیاز داشتید، از همین‌جا با واحد مربوط در ارتباط باشید.'
            : 'درخواست‌های مربوط به این بخش اینجا نمایش داده می‌شوند.'}
        </p>
        {canCreate && (
          <Button asChild variant="outline">
            <Link href="/tickets/new">
              <PlusIcon /> ثبت اولین درخواست
            </Link>
          </Button>
        )}
      </div>
    );
  return (
    <div className="ticket-list">
      <div className="ticket-table-head">
        <span>موضوع درخواست</span>
        <span>واحد پاسخ‌گو</span>
        <span>وضعیت</span>
        <span>آخرین فعالیت</span>
        <span />
      </div>
      {tickets.map((t) => (
        <Link href={`/tickets/${t.id}`} key={t.id} className="ticket-row">
          <span className="ticket-subject">
            <span className="ticket-row-icon">
              <MessageSquare size={19} />
            </span>
            <span>
              <strong>{t.subject}</strong>
              <small>
                <bdi dir="ltr">{ticketNumber(t)}</bdi>
                <span> · </span>
                <span>{priorityNames[t.priority]}</span>
              </small>
            </span>
          </span>
          <span className="ticket-department">{t.department.name}</span>
          <Status value={t.status} />
          <time className="ticket-date" dateTime={new Date(t.lastActivityAt).toISOString()}>
            {date(t.lastActivityAt)}
          </time>
          <ArrowUpLeft size={17} className="muted" />
        </Link>
      ))}
    </div>
  );
}

function PlusIcon() {
  return <span aria-hidden="true">＋</span>;
}
