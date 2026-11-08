'use client';

import {
  forwardRef,
  memo,
  useState,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  type RefObject,
} from 'react';
import { Virtuoso, type VirtuosoHandle, type Components } from 'react-virtuoso';
import { Check, LoaderCircle, Lock, MessageCircle } from 'lucide-react';
import type { getTicket } from '@niticket/core/application/tickets';
import { AttachmentPreview } from './attachment-preview';
import { Button } from './ui/button';
import { date } from '@/lib/utils';
import { SearchHighlight } from './search-highlight';

type Detail = Awaited<ReturnType<typeof getTicket>>;
type Message = Detail['messages'][number];

export type TimelineHandle = { jumpToLatest: () => void; preserveAnchor: () => void };

type Context = {
  older: boolean;
  loading: boolean;
  load: () => void;
  attachments: Detail['attachments'];
  unit: string;
  newer: boolean;
  loadNewer: () => void;
};
const timeFormat = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tehran',
});

const MessageRow = memo(function MessageRow({
  message,
  actorId,
  day,
  focused,
  terms,
}: {
  message: Message;
  actorId: string;
  day: string | null;
  focused: boolean;
  terms: string[];
}) {
  const own = message.sender.id === actorId;
  return (
    <div className="messenger-message-row">
      {day && (
        <div className="messenger-day">
          <span>{day}</span>
        </div>
      )}
      <article
        data-message-id={message.id}
        data-search-focused={focused || undefined}
        className={`messenger-bubble ${own ? 'bubble-own' : ''} ${message.visibility === 'INTERNAL' ? 'bubble-private' : ''}`}
      >
        {message.visibility === 'INTERNAL' && (
          <span className="internal-label">
            <Lock size={13} />
            یادداشت خصوصی واحد
          </span>
        )}
        <strong className="messenger-sender">{own ? 'شما' : message.sender.name}</strong>
        <p className="message-body">
          {focused ? <SearchHighlight text={message.body} terms={terms} /> : message.body}
        </p>
        <div className="message-attachments">
          {message.attachments.map((file) => (
            <AttachmentPreview key={file.id} file={file} />
          ))}
        </div>
        <time dateTime={new Date(message.createdAt).toISOString()}>
          {timeFormat.format(new Date(message.createdAt))}
          {own && <Check size={14} aria-label="ارسال شده" />}
        </time>
      </article>
    </div>
  );
});

const components: Components<Message, Context> = {
  List: forwardRef(function List(props, ref) {
    const { context, ...attributes } = props;
    void context;
    return <div {...attributes} ref={ref} className="messenger-virtual-list" />;
  }),
  Header: ({ context }) => (
    <div className="messenger-timeline-header">
      {context?.older && (
        <Button
          className="messenger-load-older"
          variant="outline"
          size="sm"
          disabled={context.loading}
          onClick={context.load}
        >
          {context.loading && <LoaderCircle size={16} className="messenger-loading" />}
          {context.loading ? 'دریافت پیام‌ها…' : 'پیام‌های قبلی'}
        </Button>
      )}
    </div>
  ),
  Footer: ({ context }) => (
    <div className="messenger-timeline-footer">
      {context?.newer && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={context.loading}
          onClick={context.loadNewer}
        >
          پیام‌های بعدی
        </Button>
      )}
      {context?.attachments.map((file) => (
        <AttachmentPreview key={file.id} file={file} />
      ))}
    </div>
  ),
  EmptyPlaceholder: ({ context }) => (
    <div className="messenger-empty">
      <span>
        <MessageCircle size={34} />
      </span>
      <h2>گفتگو با {context?.unit}</h2>
      <p>پیامتان را بنویسید، وویس ضبط کنید یا فایل بفرستید.</p>
    </div>
  ),
};

export const MessageTimeline = memo(function MessageTimeline({
  messages,
  actorId,
  older,
  loading,
  load,
  attachments,
  unit,
  apiRef,
  onBottomChange,
  jumpRequest,
  focusId,
  highlightTerms,
  newer,
  loadNewer,
}: {
  messages: Message[];
  actorId: string;
  older: boolean;
  loading: boolean;
  load: () => void;
  attachments: Detail['attachments'];
  unit: string;
  apiRef: RefObject<TimelineHandle | null>;
  onBottomChange: (value: boolean) => void;
  jumpRequest: number;
  focusId?: string | null;
  highlightTerms: string[];
  newer: boolean;
  loadNewer: () => void;
}) {
  const virtual = useRef<VirtuosoHandle>(null),
    scroller = useRef<HTMLElement | null>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  useImperativeHandle(
    apiRef,
    () => ({
      jumpToLatest: () =>
        virtual.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' }),
      preserveAnchor: () => {
        const area = scroller.current;
        if (!area) return;
        const top = area.getBoundingClientRect().top;
        const visible = Array.from(area.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (node) => node.getBoundingClientRect().bottom > top,
        );
        if (visible)
          anchor.current = {
            id: visible.dataset.messageId!,
            offset: visible.getBoundingClientRect().top - top,
          };
      },
    }),
    [],
  );
  useLayoutEffect(() => {
    if (!anchor.current) return;
    let frame: number,
      remaining = 6;
    const restore = () => {
      const saved = anchor.current,
        area = scroller.current;
      if (!saved || !area) return;
      const target = area.querySelector<HTMLElement>(`[data-message-id="${saved.id}"]`);
      if (target) {
        const delta =
          target.getBoundingClientRect().top - area.getBoundingClientRect().top - saved.offset;
        if (Math.abs(delta) > 0.5) area.scrollTop += delta;
      }
      if (--remaining > 0) frame = requestAnimationFrame(restore);
      else anchor.current = null;
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [messages]);
  useLayoutEffect(() => {
    if (jumpRequest) virtual.current?.scrollToIndex({ index: 'LAST', align: 'end' });
  }, [jumpRequest]);
  const [position, setPosition] = useState({ firstId: messages[0]?.id, firstIndex: 1_000_000 });
  // Prepending decreases the logical first index; Virtuoso preserves the visible item and its offset.
  if (position.firstId !== messages[0]?.id) {
    const added = position.firstId
      ? messages.findIndex((message) => message.id === position.firstId)
      : 0;
    setPosition({ firstId: messages[0]?.id, firstIndex: position.firstIndex - Math.max(0, added) });
  }
  return (
    <Virtuoso<Message, Context>
      ref={virtual}
      scrollerRef={(node) => {
        scroller.current = node instanceof HTMLElement ? node : null;
      }}
      onWheelCapture={() => {
        anchor.current = null;
      }}
      onPointerDownCapture={() => {
        anchor.current = null;
      }}
      className="messenger-scroll"
      aria-label="پیام‌های گفتگو"
      tabIndex={0}
      data={messages}
      context={{ older, loading, load, attachments, unit, newer, loadNewer }}
      components={components}
      firstItemIndex={position.firstIndex}
      initialTopMostItemIndex={
        focusId
          ? {
              index: Math.max(
                0,
                messages.findIndex((message) => message.id === focusId),
              ),
              align: 'center',
            }
          : messages.length
            ? { index: 'LAST', align: 'end' }
            : 0
      }
      defaultItemHeight={126}
      increaseViewportBy={{ top: 350, bottom: 350 }}
      atBottomThreshold={100}
      atBottomStateChange={onBottomChange}
      followOutput={focusId ? false : 'auto'}
      computeItemKey={(_, message) => message.id}
      itemContent={(index, message) => {
        const local = index - position.firstIndex;
        const day = date(message.createdAt);
        return (
          <MessageRow
            message={message}
            actorId={actorId}
            day={(!local ? !older : date(messages[local - 1].createdAt) !== day) ? day : null}
            focused={message.id === focusId}
            terms={highlightTerms}
          />
        );
      }}
    />
  );
});
