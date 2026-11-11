'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Bookmark,
  Info,
  Lock,
  Paperclip,
  Search,
  Send,
  LoaderCircle,
  RotateCcw,
  X,
  EllipsisVertical,
  Settings,
  MessageCircle,
} from 'lucide-react';
import type { getTicket, getMessageContext } from '@niticket/core/application/tickets';
import type { SearchSelection, SearchResult, SearchData } from './message-search';
import { searchParameters } from '@/lib/search';
import { ActiveAudio } from './audio-player';
import { stopAudio } from '@/lib/audio-playback';
import { Avatar } from './avatar';
import { ThemeToggle } from './theme-toggle';
import { HistoryNote } from './history-note';
import { AttachmentPreview } from './attachment-preview';
import { Button } from './ui/button';
import dynamic from 'next/dynamic';
import type { TimelineHandle } from './message-timeline';
import { Modal } from './ui/dialog';
import { UploadProgress } from './upload-progress';
import { VoiceRecorder } from './voice-recorder';
import { date, dateTime, digits, request, RequestError } from '@/lib/utils';
import { uploadFile } from '@/lib/upload';
import { useMessageReceipts } from '@/lib/use-message-receipts';
import { ConversationNavigation } from './notification-status';

const MessageTimeline = dynamic(
  () => import('./message-timeline').then((module) => module.MessageTimeline),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="messenger-timeline-loading">
        در حال دریافت پیام‌ها…
      </p>
    ),
  },
);
const MessageSearch = dynamic(
  () => import('./message-search').then((module) => module.MessageSearch),
  {
    loading: () => <p role="status">در حال آماده‌سازی جستجو…</p>,
  },
);
const SavedReplyPicker = dynamic(() =>
  import('./saved-replies').then((module) => module.SavedReplyPicker),
);

type Detail = Awaited<ReturnType<typeof getTicket>>;
type ChatMessage = Detail['messages'][number];

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (
      !previous ||
      previous.body !== message.body ||
      previous.visibility !== message.visibility ||
      String(previous.readAt) !== String(message.readAt) ||
      previous.sender.name !== message.sender.name ||
      previous.sender.image !== message.sender.image ||
      JSON.stringify(previous.attachments) !== JSON.stringify(message.attachments)
    )
      byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  );
}

const activityNames: Record<string, string> = {
  TICKET_CREATED: 'اولین پیام ارسال شد',
  PUBLIC_REPLY: 'پیام ارسال شد',
  INTERNAL_NOTE: 'یادداشت خصوصی ثبت شد',
  STATUS_CHANGED: 'وضعیت قبلی درخواست تغییر کرد',
  ATTACHMENT_READY: 'پیوست آماده شد',
  TRANSFERRED: 'گفتگو به واحد دیگری منتقل شد',
};

export function Conversation({
  detail,
  actorId,
  maxSeconds,
  maxBytes,
  initialContext,
  initialTerms = [],
  returnTo,
}: {
  detail: Detail;
  actorId: string;
  maxSeconds: number;
  maxBytes: number;
  initialContext?: Pick<Awaited<ReturnType<typeof getMessageContext>>, 'focusId' | 'newerCursor'>;
  initialTerms?: string[];
  returnTo?: string;
}) {
  const [data, setData] = useState(detail),
    [messages, setMessages] = useState(detail.messages),
    [olderCursor, setOlderCursor] = useState(detail.nextMessageCursor);
  const [searchOpen, setSearchOpen] = useState(false),
    [searchSelection, setSearchSelection] = useState<SearchSelection | null>(null),
    [focusId, setFocusId] = useState(initialContext?.focusId ?? null),
    [highlightTerms, setHighlightTerms] = useState(initialTerms),
    [newerCursor, setNewerCursor] = useState(initialContext?.newerCursor ?? null),
    [windowKey, setWindowKey] = useState(0),
    [finding, setFinding] = useState(false);
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const savedAttempt = useRef<{
    id: string;
    replyId: string;
    version: number;
    visibility: string;
  } | null>(null);
  const browsing = useRef(!!initialContext),
    contextRequest = useRef<AbortController | null>(null);
  const [body, setBody] = useState(''),
    [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC'),
    [files, setFiles] = useState<File[]>([]),
    [voice, setVoice] = useState<File | null>(null),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false),
    [error, setError] = useState(''),
    [info, setInfo] = useState(false),
    [newMessages, setNewMessages] = useState(false),
    [jumpRequest, setJumpRequest] = useState(0),
    [progress, setProgress] = useState<number | null>(null),
    [filename, setFilename] = useState(''),
    [pendingMessage, setPendingMessage] = useState<string | null>(null),
    [recorderKey, setRecorderKey] = useState(0);
  const [olderActivities, setOlderActivities] = useState<Detail['activities']>(detail.activities),
    [activityCursor, setActivityCursor] = useState(detail.nextActivityCursor),
    [loadingHistory, setLoadingHistory] = useState(false);
  const timeline = useRef<TimelineHandle>(null),
    input = useRef<HTMLTextAreaElement>(null),
    followLatest = useRef(true),
    mounted = useRef(true),
    sending = useRef(false),
    revision = useRef(
      `${detail.ticket.version}:${new Date(detail.ticket.updatedAt).toISOString()}`,
    ),
    currentVersion = useRef(detail.ticket.version),
    fetching = useRef<Promise<void> | null>(null),
    latestId = useRef(detail.messages.at(-1)?.id),
    attempt = useRef<{ id: string; body: string; visibility: string } | null>(null);
  const { ticket, permissions } = data;
  const id = ticket.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      contextRequest.current?.abort();
      stopAudio();
    };
  }, []);

  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const onVisibleMessages = useCallback((ids: string[]) => {
    if (mounted.current)
      setVisibleIds((previous) => (previous.join(',') === ids.join(',') ? previous : ids));
  }, []);
  const visible = useMemo(() => {
    const ids = new Set(visibleIds);
    return messages.filter((message) => ids.has(message.id));
  }, [messages, visibleIds]);
  const incoming = visible
    .filter(
      (message) =>
        message.sender.id !== actorId &&
        !message.readAt &&
        (!permissions.staff
          ? message.visibility === 'PUBLIC'
          : message.visibility === 'INTERNAL' || message.sender.id === ticket.creatorId),
    )
    .map((message) => message.id);
  const outgoing = visible
    .filter((message) => message.sender.id === actorId && !message.readAt)
    .map((message) => message.id);
  const seenIds = useMessageReceipts(
    id,
    incoming,
    outgoing,
    !permissions.readOnly && !searchOpen && !finding && !info && !savedRepliesOpen && !actionsOpen,
  );

  const refresh = useCallback(() => {
    if (fetching.current) return fetching.current;
    const task = request<{ revision: string; detail: Detail | null }>(
      `/api/v1/tickets/${id}/sync?since=${encodeURIComponent(revision.current)}`,
    )
      .then((result) => {
        if (!result.detail) return;
        const latest = result.detail;
        revision.current = result.revision;
        if (!mounted.current) return;
        currentVersion.current = Math.max(currentVersion.current, latest.ticket.version);
        const lastId = latest.messages.at(-1)?.id;
        if (lastId !== latestId.current && (!followLatest.current || browsing.current))
          setNewMessages(true);
        // A long offline interval may exceed one page; allow the missing interval to be loaded.
        if (
          !browsing.current &&
          latest.nextMessageCursor &&
          (!latestId.current || !latest.messages.some((message) => message.id === latestId.current))
        )
          setOlderCursor(latest.nextMessageCursor);
        latestId.current = lastId;
        setData(latest);
        if (!browsing.current) setMessages((previous) => mergeMessages(previous, latest.messages));
      })
      .finally(() => {
        fetching.current = null;
      });
    fetching.current = task;
    return task;
  }, [id]);

  useEffect(() => {
    if (busy || recording) return;
    const update = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => {});
    };
    const timer = setInterval(update, 5000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [busy, recording, refresh]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder || finding) return;
    setLoadingOlder(true);
    try {
      const previous = await request<{ items: ChatMessage[]; nextCursor: string | null }>(
        `/api/v1/tickets/${id}/messages?cursor=${olderCursor}`,
      );
      if (!mounted.current) return;
      followLatest.current = false;
      timeline.current?.preserveAnchor();
      setMessages((current) => mergeMessages(previous.items, current));
      setOlderCursor(previous.nextCursor);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'پیام‌های قبلی دریافت نشد.');
    } finally {
      setLoadingOlder(false);
    }
  }, [id, olderCursor, loadingOlder, finding]);

  const loadNewer = useCallback(async () => {
    if (!newerCursor || loadingOlder || finding) return;
    setLoadingOlder(true);
    try {
      const page = await request<{ items: ChatMessage[]; nextCursor: string | null }>(
        `/api/v1/tickets/${id}/messages?direction=newer&cursor=${newerCursor}`,
      );
      if (!mounted.current) return;
      timeline.current?.preserveAnchor();
      setMessages((current) => mergeMessages(current, page.items));
      setNewerCursor(page.nextCursor);
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : 'پیام‌های بعدی دریافت نشد.');
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }, [id, newerCursor, loadingOlder, finding]);

  async function showResult(result: SearchResult, selection?: SearchSelection) {
    if (loadingOlder) return;
    contextRequest.current?.abort();
    const abort = new AbortController();
    contextRequest.current = abort;
    browsing.current = true;
    followLatest.current = false;
    setFinding(true);
    setError('');
    setSearchOpen(false);
    if (selection) setSearchSelection(selection);
    try {
      const context = await request<Awaited<ReturnType<typeof getMessageContext>>>(
        `/api/v1/tickets/${id}/messages/context?messageId=${result.id}`,
        { signal: abort.signal },
      );
      if (!mounted.current || abort.signal.aborted) return;
      setMessages(context.items);
      setOlderCursor(context.olderCursor);
      setNewerCursor(context.newerCursor);
      setFocusId(context.focusId);
      setHighlightTerms(selection?.data.terms ?? []);
      setWindowKey((value) => value + 1);
    } catch (error) {
      if (mounted.current && !abort.signal.aborted) {
        browsing.current = !!focusId;
        setError(error instanceof Error ? error.message : 'پیام دریافت نشد.');
      }
    } finally {
      if (mounted.current && !abort.signal.aborted) setFinding(false);
    }
  }

  async function latestMessages() {
    contextRequest.current?.abort();
    const abort = new AbortController();
    contextRequest.current = abort;
    setFinding(true);
    try {
      const page = await request<{ items: ChatMessage[]; nextCursor: string | null }>(
        `/api/v1/tickets/${id}/messages`,
        { signal: abort.signal },
      );
      if (!mounted.current || abort.signal.aborted) return;
      browsing.current = false;
      followLatest.current = true;
      setMessages(page.items);
      setOlderCursor(page.nextCursor);
      setNewerCursor(null);
      setFocusId(null);
      setHighlightTerms([]);
      setNewMessages(false);
      latestId.current = page.items.at(-1)?.id;
      setWindowKey((value) => value + 1);
    } catch (error) {
      if (mounted.current && !abort.signal.aborted)
        setError(error instanceof Error ? error.message : 'دریافت پیام‌ها انجام نشد.');
    } finally {
      if (mounted.current && !abort.signal.aborted) setFinding(false);
    }
  }

  async function nextResult(delta: number) {
    if (!searchSelection || finding) return;
    const selected = searchSelection,
      index = selected.index + delta;
    if (selected.data.items[index]) {
      await showResult(selected.data.items[index], { ...selected, index });
      return;
    }
    const cursor = delta > 0 ? selected.data.nextCursor : selected.previous.at(-1);
    if (delta > 0 ? !cursor : !selected.previous.length) return;
    contextRequest.current?.abort();
    const abort = new AbortController();
    contextRequest.current = abort;
    setFinding(true);
    try {
      const page = await request<SearchData>(
        `/api/v1/search?${searchParameters({ ...selected.filters, cursor: cursor ?? undefined })}`,
        { signal: abort.signal },
      );
      if (!mounted.current || abort.signal.aborted) return;
      const index = delta > 0 ? 0 : page.items.length - 1;
      if (!page.items[index]) {
        setFinding(false);
        return;
      }
      await showResult(page.items[index], {
        filters: selected.filters,
        data: page,
        index,
        cursor: cursor ?? undefined,
        previous:
          delta > 0 ? [...selected.previous, selected.cursor] : selected.previous.slice(0, -1),
      });
    } catch (error) {
      if (mounted.current && !abort.signal.aborted) {
        setError(error instanceof Error ? error.message : 'جستجو انجام نشد.');
        setFinding(false);
      }
    }
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);

  const onBottomChange = useCallback((atBottom: boolean) => {
    if (browsing.current) {
      followLatest.current = false;
      return;
    }
    followLatest.current = atBottom;
    if (atBottom) setNewMessages(false);
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (
      sending.current ||
      finding ||
      recording ||
      (!pendingMessage && !body.trim() && !files.length && !voice)
    )
      return;
    sending.current = true;
    setBusy(true);
    setError('');
    let savedId = pendingMessage;
    try {
      if (!savedId) {
        const text = body.trim() || (voice && !files.length ? 'پیام صوتی' : 'فایل پیوست');
        if (
          !attempt.current ||
          attempt.current.body !== text ||
          attempt.current.visibility !== visibility
        )
          attempt.current = { id: crypto.randomUUID(), body: text, visibility };
        const payload = { body: text, visibility, clientId: attempt.current.id };
        let result: { id: string; version: number };
        try {
          result = await request(`/api/v1/tickets/${id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ ...payload, version: currentVersion.current }),
          });
        } catch (error) {
          if (!(error instanceof RequestError) || error.status !== 409) throw error;
          await fetching.current?.catch(() => {});
          await refresh();
          result = await request(`/api/v1/tickets/${id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ ...payload, version: currentVersion.current }),
          });
        }
        savedId = result.id;
        currentVersion.current = Math.max(currentVersion.current, result.version);
        setPendingMessage(savedId);
        setBody('');
        attempt.current = null;
        if (input.current) input.current.style.height = '';
        if (permissions.staff && visibility === 'PUBLIC')
          window.dispatchEvent(new Event('notifications:changed'));
      }
      for (const file of files) {
        setFilename(file.name);
        setProgress(0);
        await uploadFile(file, id, savedId, setProgress);
        setFiles((current) => current.filter((item) => item !== file));
      }
      if (voice) {
        setFilename('پیام صوتی');
        setProgress(0);
        await uploadFile(voice, id, savedId, setProgress);
        setVoice(null);
        setRecorderKey((key) => key + 1);
      }
      setPendingMessage(null);
      setProgress(null);
      followLatest.current = true;
      setNewMessages(false);
      await fetching.current?.catch(() => {});
      await refresh();
      if (browsing.current) await latestMessages();
      else setJumpRequest((value) => value + 1);
    } catch (error) {
      setError(
        `${error instanceof Error ? error.message : 'ارسال انجام نشد.'}${savedId ? ' پیام ذخیره شده؛ ارسال فایل‌ها را دوباره امتحان کنید.' : ''}`,
      );
      void refresh().catch(() => {});
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function sendSavedReply(savedReplyId: string, savedReplyVersion: number) {
    if (sending.current || recording) return;
    sending.current = true;
    setBusy(true);
    try {
      if (
        !savedAttempt.current ||
        savedAttempt.current.replyId !== savedReplyId ||
        savedAttempt.current.version !== savedReplyVersion ||
        savedAttempt.current.visibility !== visibility
      )
        savedAttempt.current = {
          id: crypto.randomUUID(),
          replyId: savedReplyId,
          version: savedReplyVersion,
          visibility,
        };
      const payload = {
        savedReplyId,
        savedReplyVersion,
        clientId: savedAttempt.current.id,
        visibility,
      };
      const send = () =>
        request<{ id: string; version: number }>(`/api/v1/tickets/${id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ ...payload, version: currentVersion.current }),
        });
      let result;
      try {
        result = await send();
      } catch (error) {
        if (!(error instanceof RequestError) || error.code !== 'CONFLICT') throw error;
        await fetching.current?.catch(() => {});
        await refresh();
        result = await send();
      }
      currentVersion.current = Math.max(currentVersion.current, result.version);
      savedAttempt.current = null;
      setSavedRepliesOpen(false);
      if (visibility === 'PUBLIC') window.dispatchEvent(new Event('notifications:changed'));
      followLatest.current = true;
      setNewMessages(false);
      await fetching.current?.catch(() => {});
      await refresh();
      if (browsing.current) await latestMessages();
      else setJumpRequest((value) => value + 1);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

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
  useEffect(() => {
    if (!info || !historyOpen) return;
    const initial = setTimeout(() => void fetchHistory(), 0);
    const timer = setInterval(() => void fetchHistory(), 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [info, historyOpen, fetchHistory]);
  const activities = useMemo(
    () => [...new Map(olderActivities.map((activity) => [activity.id, activity])).values()],
    [olderActivities],
  );
  const counterpart =
    permissions.staff || permissions.readOnly ? ticket.creator.name : ticket.department.name;
  const conversationControls = (
    <>
      <Link
        href={
          returnTo ??
          (permissions.readOnly ? `/admin/departments/${ticket.departmentId}/history` : '/')
        }
        aria-label={returnTo ? 'بازگشت به نتایج جستجو' : 'بازگشت به گفتگوها'}
        className="messenger-back"
      >
        <ArrowRight size={24} />
      </Link>
      <Avatar
        name={
          permissions.staff || permissions.readOnly
            ? counterpart
            : (data.responsible?.name ?? counterpart)
        }
        image={
          permissions.staff || permissions.readOnly ? ticket.creator.image : data.responsible?.image
        }
      />
      <div className="messenger-contact">
        <h1>{counterpart}</h1>
        <p className="officer-unit">
          {permissions.staff || permissions.readOnly
            ? ticket.department.name
            : data.responsible
              ? `مسئول: ${data.responsible.name}`
              : 'مسئول واحد هنوز تعیین نشده'}
        </p>
      </div>
      <button
        type="button"
        className="messenger-info-button chat-search-quick"
        aria-label="جستجو در این گفتگو"
        disabled={busy || recording || loadingOlder || finding}
        aria-expanded={searchOpen}
        aria-controls="chat-message-search"
        onClick={() => setSearchOpen((open) => !open)}
      >
        <Search size={22} />
      </button>
      <button
        type="button"
        className="messenger-info-button chat-info-quick"
        aria-label="اطلاعات گفتگو"
        onClick={() => setInfo(true)}
      >
        <Info size={23} />
      </button>
      {permissions.readOnly && <ThemeToggle />}
      {permissions.staff && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="saved-reply-trigger"
          aria-label="پیام‌های آماده"
          title="پیام‌های آماده"
          disabled={busy || recording || finding || !!pendingMessage}
          onClick={() => setSavedRepliesOpen(true)}
        >
          <Bookmark size={21} />
        </Button>
      )}
      <button
        type="button"
        className="messenger-info-button chat-actions-trigger"
        aria-label="گزینه‌های گفتگو"
        aria-haspopup="dialog"
        aria-expanded={actionsOpen}
        onClick={() => setActionsOpen(true)}
      >
        <EllipsisVertical size={22} />
      </button>
    </>
  );
  const conversationState = (
    <>
      <ActiveAudio />
      {!searchOpen && (focusId || finding) && (
        <div className="messenger-search-context" aria-label="پیام پیدا‌شده">
          <div>
            <strong>
              {finding
                ? 'در حال دریافت پیام…'
                : searchSelection
                  ? `نتیجه ${digits(searchSelection.previous.length * 20 + searchSelection.index + 1)}`
                  : 'پیام پیدا‌شده'}
            </strong>
            {searchSelection && (
              <button type="button" onClick={() => setSearchOpen(true)} disabled={finding}>
                مشاهده نتایج
              </button>
            )}
          </div>
          {searchSelection && (
            <div className="messenger-match-navigation">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="نتیجه قبلی"
                disabled={
                  finding ||
                  loadingOlder ||
                  (!searchSelection.index && !searchSelection.previous.length)
                }
                onClick={() => void nextResult(-1)}
              >
                <ArrowUp size={18} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="نتیجه بعدی"
                disabled={
                  finding ||
                  loadingOlder ||
                  (searchSelection.index === searchSelection.data.items.length - 1 &&
                    !searchSelection.data.nextCursor)
                }
                onClick={() => void nextResult(1)}
              >
                <ArrowDown size={18} />
              </Button>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={finding || loadingOlder}
            onClick={() => void latestMessages()}
          >
            آخرین پیام‌ها
          </Button>
        </div>
      )}
      {error && !permissions.reply && (
        <p role="alert" className="error-message messenger-search-feedback">
          {error}
        </p>
      )}
    </>
  );
  return (
    <div className="messenger-chat">
      <header className="messenger-header">{conversationControls}</header>
      {permissions.readOnly && (
        <p className="messenger-readonly">
          <Lock size={14} />
          مشاهده گفتگو توسط مدیر
        </p>
      )}
      {permissions.readOnly && conversationState}
      <div className="messenger-message-area">
        {searchOpen && (
          <section
            id="chat-message-search"
            className="messenger-inline-search"
            aria-label="جستجو در این گفتگو"
          >
            <MessageSearch
              actorId={actorId}
              privateAllowed={permissions.staff || permissions.readOnly}
              inline
              syncUrl={false}
              initial={{ ticketId: id }}
              restore={searchSelection}
              onClose={() => setSearchOpen(false)}
              onSelect={(result, selected) => void showResult(result, selected)}
            />
          </section>
        )}
        <div
          className="messenger-timeline-content"
          style={searchOpen ? { visibility: 'hidden' } : undefined}
          inert={searchOpen}
          aria-hidden={searchOpen}
        >
          <MessageTimeline
            key={windowKey}
            messages={messages}
            seenIds={seenIds}
            onVisibleMessages={permissions.readOnly ? undefined : onVisibleMessages}
            actorId={actorId}
            older={!!olderCursor}
            loading={loadingOlder || finding}
            load={loadOlder}
            attachments={focusId ? [] : data.attachments}
            unit={ticket.department.name}
            apiRef={timeline}
            onBottomChange={onBottomChange}
            jumpRequest={jumpRequest}
            focusId={focusId}
            highlightTerms={highlightTerms}
            newer={!!newerCursor}
            loadNewer={loadNewer}
          />
        </div>
        {!searchOpen && newMessages && (
          <Button
            type="button"
            className="messenger-jump"
            size="sm"
            onClick={() => {
              if (browsing.current) {
                void latestMessages();
                return;
              }
              followLatest.current = true;
              timeline.current?.jumpToLatest();
              setNewMessages(false);
            }}
          >
            پیام جدید <ArrowDown size={16} />
          </Button>
        )}
      </div>
      {!permissions.readOnly && conversationState}
      {permissions.reply && (
        <form
          className={`messenger-composer ${visibility === 'INTERNAL' ? 'messenger-composer-private' : ''}`}
          onSubmit={send}
        >
          {permissions.staff && (
            <div className="messenger-visibility">
              <button
                type="button"
                aria-pressed={visibility === 'PUBLIC'}
                disabled={busy || !!pendingMessage}
                onClick={() => setVisibility('PUBLIC')}
              >
                پاسخ به فرستنده
              </button>
              <button
                type="button"
                aria-pressed={visibility === 'INTERNAL'}
                disabled={busy || !!pendingMessage}
                onClick={() => setVisibility('INTERNAL')}
              >
                <Lock size={13} />
                یادداشت خصوصی
              </button>
            </div>
          )}
          {visibility === 'INTERNAL' && (
            <p className="messenger-private-notice">
              این پیام را فقط مسئولان واحد و مدیر می‌بینند.
            </p>
          )}
          {!!files.length && (
            <div className="selected-files">
              {files.map((file, index) => (
                <span key={`${file.name}-${index}`}>
                  <Paperclip size={14} />
                  <bdi>{file.name}</bdi>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`حذف ${file.name}`}
                    onClick={() =>
                      setFiles((current) => current.filter((_, item) => item !== index))
                    }
                  >
                    <X size={17} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="messenger-input-row">
            <label className="sr-only" htmlFor="reply">
              پاسخ شما
            </label>
            <textarea
              id="reply"
              ref={input}
              rows={1}
              enterKeyHint="send"
              value={body}
              maxLength={20000}
              disabled={busy || !!pendingMessage}
              placeholder={
                pendingMessage
                  ? 'ارسال فایل‌ها را تکمیل کنید…'
                  : visibility === 'INTERNAL'
                    ? 'یادداشت خصوصی…'
                    : 'پیام…'
              }
              onChange={(event) => {
                setBody(event.target.value);
                event.currentTarget.style.height = 'auto';
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <label className="messenger-attach" title="عکس یا فایل">
              <Paperclip size={21} />
              <span className="sr-only">عکس یا فایل</span>
              <input
                id="attachment"
                type="file"
                multiple
                disabled={busy}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.webm,.ogg,.m4a,.mp4,.mp3,.wav"
                onChange={(event) => {
                  const chosen = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (chosen.some((file) => file.size > maxBytes)) {
                    setError(
                      `حجم هر فایل حداکثر ${digits(Math.ceil(maxBytes / 1048576))} مگابایت باشد.`,
                    );
                    return;
                  }
                  if (files.length + chosen.length > 5) {
                    setError('در هر پیام حداکثر ۵ فایل بفرستید.');
                    return;
                  }
                  setError('');
                  setFiles((current) => [...current, ...chosen]);
                }}
              />
            </label>
            <fieldset className="messenger-voice" disabled={busy}>
              <VoiceRecorder
                compact
                key={recorderKey}
                onFile={setVoice}
                onRecordingChange={setRecording}
                maxSeconds={maxSeconds}
                maxBytes={maxBytes}
              />
            </fieldset>
            <Button
              type="submit"
              className="messenger-send"
              aria-label={pendingMessage ? 'تلاش دوباره برای ارسال' : 'ارسال پیام'}
              title={pendingMessage ? 'تلاش دوباره برای ارسال' : 'ارسال پیام (Enter)'}
              aria-busy={busy}
              disabled={
                busy ||
                finding ||
                recording ||
                (!pendingMessage && !body.trim() && !files.length && !voice)
              }
            >
              {busy ? (
                <LoaderCircle size={22} className="download-spinner" />
              ) : pendingMessage ? (
                <RotateCcw size={22} />
              ) : (
                <Send size={22} />
              )}
            </Button>
          </div>
          {progress !== null && <UploadProgress filename={filename} percent={progress} />}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <Modal
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="گزینه‌های گفتگو"
        description={counterpart}
        presentation="sheet"
        onCloseAutoFocus={(event) => {
          if (info || savedRepliesOpen || searchOpen) event.preventDefault();
        }}
      >
        <div className="chat-actions-list">
          <button
            type="button"
            disabled={busy || recording || finding}
            onClick={() => {
              setActionsOpen(false);
              setSearchOpen(true);
            }}
          >
            <Search size={20} />
            <span>جستجو در این گفتگو</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActionsOpen(false);
              setInfo(true);
            }}
          >
            <Info size={20} />
            <span>اطلاعات گفتگو</span>
          </button>
          {permissions.staff && (
            <button
              type="button"
              disabled={busy || recording || finding || !!pendingMessage}
              onClick={() => {
                setActionsOpen(false);
                setSavedRepliesOpen(true);
              }}
            >
              <Bookmark size={20} />
              <span>پیام‌های آماده</span>
            </button>
          )}
          <Link
            href={permissions.readOnly ? '/admin/departments' : '/'}
            onClick={() => setActionsOpen(false)}
          >
            {permissions.readOnly ? (
              <>
                <MessageCircle size={20} />
                <span>واحدها و گفتگوها</span>
              </>
            ) : (
              <ConversationNavigation />
            )}
          </Link>
          <Link
            href={permissions.readOnly ? '/profile' : '/settings'}
            onClick={() => setActionsOpen(false)}
          >
            <Settings size={20} />
            <span>تنظیمات</span>
          </Link>
        </div>
      </Modal>
      {permissions.staff && (
        <Modal
          open={savedRepliesOpen}
          onOpenChange={(open) => {
            if (!busy) setSavedRepliesOpen(open);
          }}
          title="پیام‌های آماده"
          description="یک پیام را انتخاب کنید و پیش از ارسال ببینید."
        >
          {savedRepliesOpen && (
            <SavedReplyPicker departmentId={ticket.departmentId} onSend={sendSavedReply} />
          )}
        </Modal>
      )}
      <Modal
        open={info}
        onOpenChange={(value) => {
          setInfo(value);
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
            {activities.map((activity) => (
              <article className="history-event" key={activity.id}>
                <div className="history-event-title">
                  <strong>{activityNames[activity.type] ?? 'گفتگو به‌روزرسانی شد'}</strong>
                  <time>{dateTime(activity.createdAt)}</time>
                </div>
                {activity.notes.map((note) => (
                  <div key={note.id} className="history-note">
                    <strong>{note.author.name}</strong>
                    <p className="message-body">{note.body}</p>
                    {note.attachments.map((file) => (
                      <AttachmentPreview key={file.id} file={file} />
                    ))}
                  </div>
                ))}
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
            ))}
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
    </div>
  );
}
