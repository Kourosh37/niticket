'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { getTicket } from '@niticket/core/application/tickets';
import { useRealtimeSync } from '@/lib/use-realtime-sync';
import { request, date, dateTime } from '@/lib/utils';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';
import { PagedItems, PagedText } from './ui/paged-content';
import { AttachmentPreview } from './attachment-preview';
import { HistoryNote } from './history-note';

type Detail = Awaited<ReturnType<typeof getTicket>>;
type DetailsData = Pick<
  Detail,
  'permissions' | 'responsible' | 'activities' | 'nextActivityCursor'
> & {
  ticket: Pick<Detail['ticket'], 'id' | 'creator' | 'department' | 'createdAt'>;
};

const activityNames: Record<string, string> = {
  TICKET_CREATED: 'اولین پیام ارسال شد',
  PUBLIC_REPLY: 'پیام ارسال شد',
  INTERNAL_NOTE: 'یادداشت خصوصی ثبت شد',
  STATUS_CHANGED: 'وضعیت قبلی درخواست تغییر کرد',
  ATTACHMENT_READY: 'پیوست آماده شد',
  TRANSFERRED: 'گفتگو به واحد دیگری منتقل شد',
};

export function ConversationDetails({
  open: info,
  onOpenChange,
  data,
  maxSeconds,
  maxBytes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DetailsData;
  maxSeconds: number;
  maxBytes: number;
}) {
  const { ticket, permissions } = data;
  const { id } = ticket;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [olderActivities, setOlderActivities] = useState<Detail['activities']>(data.activities),
    [activityCursor, setActivityCursor] = useState(data.nextActivityCursor),
    [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false),
    [historyError, setHistoryError] = useState('');
  const historyInFlight = useRef(false);
  const historyPaged = useRef(false);
  const fetchHistory = useCallback(
    async (cursor?: string) => {
      if (historyInFlight.current) return;
      historyInFlight.current = true;
      setLoadingHistory(true);
      try {
        const page = await request<{ items: Detail['activities']; nextCursor: string | null }>(
          `/api/v1/tickets/${id}/history${cursor ? `?cursor=${cursor}` : ''}`,
        );
        if (!mounted.current) return;
        setHistoryError('');
        setOlderActivities((current) =>
          [
            ...new Map(
              [...current, ...page.items].map((activity) => [activity.id, activity]),
            ).values(),
          ].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
              b.id.localeCompare(a.id),
          ),
        );
        if (cursor) historyPaged.current = true;
        if (cursor || !historyPaged.current) setActivityCursor(page.nextCursor);
      } catch (error) {
        if (mounted.current)
          setHistoryError(error instanceof Error ? error.message : 'تاریخچه دریافت نشد.');
      } finally {
        historyInFlight.current = false;
        if (mounted.current) setLoadingHistory(false);
      }
    },
    [id],
  );
  const refreshActivity = useCallback(
    async (activityId: string) => {
      try {
        const activity = await request<Detail['activities'][number]>(
          `/api/v1/tickets/${id}/history/${activityId}`,
        );
        if (mounted.current) {
          setOlderActivities((current) =>
            current.map((item) => (item.id === activity.id ? activity : item)),
          );
          setHistoryError('');
        }
      } catch (error) {
        if (mounted.current)
          setHistoryError(error instanceof Error ? error.message : 'تاریخچه دریافت نشد.');
      }
    },
    [id],
  );
  useRealtimeSync(() => fetchHistory(), ['conversation', 'attachments'], {
    ticketId: id,
    enabled: info && historyOpen,
    fallbackMs: 15000,
  });
  const activities = useMemo(
    () => [...new Map(olderActivities.map((activity) => [activity.id, activity])).values()],
    [olderActivities],
  );
  return (
    <Modal
      open={info}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setHistoryOpen(false);
      }}
      title="اطلاعات گفتگو"
      description={ticket.department.name}
    >
      <dl className="messenger-details">
        <div>
          <dt>فرستنده</dt>
          <dd>{ticket.creator.name}</dd>
        </div>
        <div>
          <dt>واحد</dt>
          <dd>{ticket.department.name}</dd>
        </div>
        <div>
          <dt>مسئول واحد</dt>
          <dd>{data.responsible?.name ?? 'هنوز تعیین نشده'}</dd>
        </div>
        <div>
          <dt>شروع گفتگو</dt>
          <dd>{date(ticket.createdAt)}</dd>
        </div>
      </dl>
      {(permissions.staff || permissions.readOnly) && (
        <details
          className="messenger-history"
          open={historyOpen}
          onToggle={(event) => {
            setHistoryOpen(event.currentTarget.open);
          }}
        >
          <summary>تاریخچه و یادداشت‌های واحد</summary>
          {loadingHistory && <p role="status">در حال دریافت تاریخچه…</p>}
          {historyError && (
            <p role="alert" className="error-message">
              {historyError}
              <Button type="button" variant="ghost" onClick={() => void fetchHistory()}>
                تلاش دوباره
              </Button>
            </p>
          )}
          {!loadingHistory && !historyError && !activities.length && (
            <p className="muted">هنوز رویدادی برای این گفتگو ثبت نشده است.</p>
          )}
          <PagedItems
            items={activities}
            pageSize={1}
            compactSize={1}
            label="صفحه‌بندی تاریخچه"
            renderItem={(activity) => (
              <article className="history-event" key={activity.id}>
                <div className="history-event-title">
                  <strong>{activityNames[activity.type] ?? 'گفتگو به‌روزرسانی شد'}</strong>
                  <time>{dateTime(activity.createdAt)}</time>
                </div>
                <PagedItems
                  items={activity.notes}
                  pageSize={1}
                  compactSize={1}
                  label="صفحه‌بندی یادداشت‌ها"
                  renderItem={(note) => (
                    <div key={note.id} className="history-note">
                      <strong>{note.author.name}</strong>
                      <PagedText text={note.body} />
                      <PagedItems
                        items={note.attachments}
                        pageSize={1}
                        compactSize={1}
                        label="پیوست‌های یادداشت"
                        renderItem={(file) => <AttachmentPreview key={file.id} file={file} />}
                      />
                    </div>
                  )}
                />
                {permissions.staff && (
                  <HistoryNote
                    ticketId={id}
                    activityId={activity.id}
                    maxSeconds={maxSeconds}
                    maxBytes={maxBytes}
                    onSaved={() => void refreshActivity(activity.id)}
                  />
                )}
              </article>
            )}
          />
          {activityCursor && (
            <Button
              type="button"
              variant="outline"
              disabled={loadingHistory}
              onClick={() => {
                setLoadingHistory(true);
                void fetchHistory(activityCursor ?? undefined);
              }}
            >
              رویدادهای قبلی
            </Button>
          )}
        </details>
      )}
    </Modal>
  );
}
