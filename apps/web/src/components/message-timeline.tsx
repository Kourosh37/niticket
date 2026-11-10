'use client';

import {
  forwardRef,
  memo,
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
  useImperativeHandle,
  type RefObject,
} from 'react';
import { Virtuoso, type Components } from 'react-virtuoso';
import { Check, CheckCheck, LoaderCircle, Lock, MessageCircle } from 'lucide-react';
import { observeVisibleMessages } from '@/lib/message-visibility';
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
  seen,
}: {
  message: Message;
  actorId: string;
  day: string | null;
  focused: boolean;
  terms: string[];
  seen: boolean;
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
        data-read={own ? String(seen) : undefined}
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
          {own &&
            (seen ? (
              <CheckCheck size={16} className="message-read-receipt" aria-label="دیده شد" />
            ) : (
              <Check size={14} aria-label="ارسال شده" />
            ))}
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
  seenIds,
  onVisibleMessages,
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
  seenIds: ReadonlySet<string>;
  onVisibleMessages?: (ids: string[]) => void;
}) {
  const scroller = useRef<HTMLElement | null>(null),
    following = useRef(!focusId),
    geometry = useRef({ height: 0, viewport: 0 }),
    previousTail = useRef(messages.at(-1)?.id);
  const followEnd = useCallback(() => {
    const area = scroller.current;
    if (area && following.current && !focusId) area.scrollTop = area.scrollHeight;
  }, [focusId]);
  const jumpToLatest = useCallback(() => {
    following.current = true;
    followEnd();
  }, [followEnd]);
  // Native follow scrolls have no delayed scrollToIndex retries that could
  // override an upward user scroll after the new batch is painted.
  useLayoutEffect(() => {
    const tail = messages.at(-1)?.id;
    const appended = tail !== previousTail.current;
    previousTail.current = tail;
    if (appended && following.current) jumpToLatest();
  }, [messages, jumpToLatest]);
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const area = scroller.current;
    if (!area) return;
    const observer = new ResizeObserver(followEnd);
    observer.observe(area);
    const list = area.querySelector('.messenger-virtual-list');
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [followEnd, hasMessages]);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  useEffect(() => {
    if (scroller.current && onVisibleMessages)
      return observeVisibleMessages(scroller.current, onVisibleMessages);
  }, [onVisibleMessages]);
  useImperativeHandle(
    apiRef,
    () => ({
      jumpToLatest,
      preserveAnchor: () => {
        following.current = false;
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
    [jumpToLatest],
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
    if (jumpRequest) jumpToLatest();
  }, [jumpRequest, jumpToLatest]);
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
      scrollerRef={(node) => {
        scroller.current = node instanceof HTMLElement ? node : null;
      }}
      onWheelCapture={(event) => {
        anchor.current = null;
        if (event.deltaY < 0) following.current = false;
      }}
      onKeyDownCapture={(event) => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) following.current = false;
      }}
      onTouchMoveCapture={() => {
        following.current = false;
      }}
      onScrollCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        const area = event.currentTarget;
        const height = area.scrollHeight,
          viewport = area.clientHeight;
        const resized =
          height !== geometry.current.height || viewport !== geometry.current.viewport;
        // A measured row or composer resize can temporarily move the bottom
        // while following. Only a scroll within unchanged geometry pauses it;
        // upward input above already pauses immediately, including during resize.
        following.current =
          height - area.scrollTop - viewport <= 100 || (resized && following.current);
        geometry.current = { height, viewport };
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
      followOutput={false}
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
            seen={!!message.readAt || seenIds.has(message.id)}
            terms={highlightTerms}
          />
        );
      }}
    />
  );
});
