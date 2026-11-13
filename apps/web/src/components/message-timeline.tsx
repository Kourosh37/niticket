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
import { Virtuoso, type Components, type VirtuosoHandle } from 'react-virtuoso';
import { Check, CheckCheck, LoaderCircle, Lock, MessageCircle } from 'lucide-react';
import { observeVisibleMessages } from '@/lib/message-visibility';
import type { getTicket } from '@niticket/core/application/tickets';
import { AttachmentPreview } from './attachment-preview';
import { Button } from './ui/button';
import { date } from '@/lib/utils';
import { SearchHighlight } from './search-highlight';
import { shouldFollowLatest } from '@/lib/scroll-follow';

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
  restorePosition,
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
  restorePosition?: { id: string; offset: number };
}) {
  const virtualizer = useRef<VirtuosoHandle | null>(null);
  const initialPositioning = useRef(!focusId && !restorePosition);
  const returningToEnd = useRef(false);
  const scroller = useRef<HTMLElement | null>(null),
    following = useRef(!focusId && !restorePosition),
    geometry = useRef({ height: 0, viewport: 0, top: 0 }),
    previousTail = useRef(messages.at(-1)?.id);
  const setFollowing = useCallback(
    (value: boolean) => {
      if (following.current === value) return;
      following.current = value;
      onBottomChange(value);
    },
    [onBottomChange],
  );
  const followEnd = useCallback(() => {
    const area = scroller.current;
    if (area && following.current && !focusId) area.scrollTop = area.scrollHeight;
  }, [focusId]);
  const jumpToLatest = useCallback(() => {
    initialPositioning.current = false;
    setFollowing(true);
    followEnd();
  }, [followEnd, setFollowing]);
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
  const anchor = useRef<{ id: string; offset: number } | null>(restorePosition ?? null);
  useEffect(() => {
    if (scroller.current && onVisibleMessages)
      return observeVisibleMessages(scroller.current, onVisibleMessages);
  }, [onVisibleMessages]);
  useImperativeHandle(
    apiRef,
    () => ({
      jumpToLatest,
      preserveAnchor: () => {
        initialPositioning.current = false;
        returningToEnd.current = false;
        setFollowing(false);
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
    [jumpToLatest, setFollowing],
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
      ref={virtualizer}
      scrollerRef={(node) => {
        scroller.current = node instanceof HTMLElement ? node : null;
      }}
      onWheelCapture={(event) => {
        anchor.current = null;
        initialPositioning.current = false;
        if (event.deltaY < 0) {
          returningToEnd.current = false;
          setFollowing(false);
        } else if (event.deltaY > 0) {
          returningToEnd.current = true;
          const area = event.currentTarget;
          if (area.scrollHeight - area.clientHeight - area.scrollTop <= 1) setFollowing(true);
        }
      }}
      onKeyDownCapture={(event) => {
        if (
          ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
        ) {
          initialPositioning.current = false;
          anchor.current = null;
        }
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
          returningToEnd.current = false;
          setFollowing(false);
        }
        if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key))
          returningToEnd.current = true;
        if (
          event.target === event.currentTarget &&
          event.ctrlKey &&
          (event.key === 'Home' || event.key === 'End')
        ) {
          event.preventDefault();
          setFollowing(event.key === 'End');
          // Native jumps can be overwritten by Virtuoso's pending prepend measurements.
          // Its indexed API keeps this explicit keyboard destination through those updates.
          virtualizer.current?.scrollToIndex({
            index: event.key === 'Home' ? 0 : 'LAST',
            align: event.key === 'Home' ? 'start' : 'end',
            behavior: 'auto',
          });
        }
      }}
      onTouchMoveCapture={() => {
        returningToEnd.current = true;
        anchor.current = null;
        initialPositioning.current = false;
        setFollowing(false);
      }}
      onTouchEndCapture={(event) => {
        const area = event.currentTarget;
        if (area.scrollHeight - area.clientHeight - area.scrollTop <= 1) setFollowing(true);
      }}
      onScrollCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        const area = event.currentTarget;
        const height = area.scrollHeight,
          viewport = area.clientHeight;
        const resized =
          height !== geometry.current.height || viewport !== geometry.current.viewport;
        const gap = height - area.scrollTop - viewport;
        const movingUp = area.scrollTop < geometry.current.top;
        // Keep measurement tolerance only while already following. After an upward
        // gesture, the reader must actually return to the end to enable it again.
        // Allow Virtuoso to place the initial rows above the footer before any
        // reader input, without treating its corrections as a manual scroll.
        setFollowing(
          shouldFollowLatest({
            following: following.current,
            initial: initialPositioning.current,
            returning: returningToEnd.current,
            restoring: !!anchor.current,
            gap,
            movingUp,
            resized,
          }),
        );
        geometry.current = { height, viewport, top: area.scrollTop };
      }}
      onPointerDownCapture={(event) => {
        anchor.current = null;
        returningToEnd.current = false;
        if (event.target === event.currentTarget || event.button === 1) {
          returningToEnd.current = true;
          initialPositioning.current = false;
          setFollowing(false);
        }
      }}
      onPointerUpCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        const area = event.currentTarget;
        if (area.scrollHeight - area.clientHeight - area.scrollTop <= 1) setFollowing(true);
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
          : restorePosition
            ? {
                index: Math.max(
                  0,
                  messages.findIndex((message) => message.id === restorePosition.id),
                ),
                align: 'start',
                offset: -restorePosition.offset,
              }
            : // Native following owns the initial bottom position too. Virtuoso's LAST
              // target queues delayed retries that can override an early upward gesture.
              0
      }
      defaultItemHeight={126}
      increaseViewportBy={{ top: 350, bottom: 350 }}
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
