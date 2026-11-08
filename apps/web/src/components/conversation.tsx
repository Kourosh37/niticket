'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Info,
  LoaderCircle,
  Lock,
  MessageCircle,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import type { getTicket } from '@niticket/core/application/tickets';
import { Avatar } from './avatar';
import { AttachmentPreview } from './attachment-preview';
import { Button } from './ui/button';
import { HistoryNote } from './history-note';
import { Modal } from './ui/dialog';
import { UploadProgress } from './upload-progress';
import { VoiceRecorder } from './voice-recorder';
import { date, dateTime, digits, request, RequestError } from '@/lib/utils';
import { uploadFile } from '@/lib/upload';

type Detail = Awaited<ReturnType<typeof getTicket>>;
type ChatMessage = Detail['messages'][number];

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
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
}: {
  detail: Detail;
  actorId: string;
  maxSeconds: number;
  maxBytes: number;
}) {
  const [data, setData] = useState(detail),
    [messages, setMessages] = useState(detail.messages),
    [olderCursor, setOlderCursor] = useState(detail.nextMessageCursor);
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
    [progress, setProgress] = useState<number | null>(null),
    [filename, setFilename] = useState(''),
    [pendingMessage, setPendingMessage] = useState<string | null>(null),
    [recorderKey, setRecorderKey] = useState(0);
  const [olderActivities, setOlderActivities] = useState<Detail['activities']>(detail.activities),
    [activityCursor, setActivityCursor] = useState(detail.nextActivityCursor),
    [loadingHistory, setLoadingHistory] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    stream = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    followLatest = useRef(true),
    anchor = useRef<{ height: number; top: number; messageId?: string; offset?: number } | null>(
      null,
    ),
    mounted = useRef(true),
    sending = useRef(false),
    revision = useRef(
      `${detail.ticket.version}:${new Date(detail.ticket.updatedAt).toISOString()}`,
    ),
    currentVersion = useRef(detail.ticket.version),
    fetching = useRef<Promise<void> | null>(null),
    latestId = useRef(detail.messages.at(-1)?.id),
    latestActivityId = useRef(detail.activities[0]?.id),
    attempt = useRef<{ id: string; body: string; visibility: string } | null>(null);
  const { ticket, permissions } = data;
  const id = ticket.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        if (lastId !== latestId.current && !followLatest.current) setNewMessages(true);
        // A long offline interval may exceed one page; allow the missing interval to be loaded.
        if (
          latest.nextMessageCursor &&
          (!latestId.current || !latest.messages.some((message) => message.id === latestId.current))
        )
          setOlderCursor(latest.nextMessageCursor);
        if (
          latest.nextActivityCursor &&
          (!latestActivityId.current ||
            !latest.activities.some((activity) => activity.id === latestActivityId.current))
        )
          setActivityCursor(latest.nextActivityCursor);
        latestId.current = lastId;
        latestActivityId.current = latest.activities[0]?.id;
        setData(latest);
        setMessages((previous) => mergeMessages(previous, latest.messages));
        setOlderActivities((previous) => [
          ...new Map(
            [...previous, ...latest.activities].map((activity) => [activity.id, activity]),
          ).values(),
        ]);
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

  useLayoutEffect(() => {
    const area = viewport.current;
    if (!area) return;
    if (anchor.current) {
      const target = anchor.current.messageId
        ? area.querySelector<HTMLElement>(`[data-message-id="${anchor.current.messageId}"]`)
        : null;
      if (target && anchor.current.offset !== undefined)
        area.scrollTop +=
          target.getBoundingClientRect().top -
          area.getBoundingClientRect().top -
          anchor.current.offset;
      else area.scrollTop = anchor.current.top + area.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (followLatest.current) area.scrollTop = area.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!stream.current) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current && !anchor.current && viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    observer.observe(stream.current);
    return () => observer.disconnect();
  }, []);

  async function loadOlder() {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const previous = await request<Detail>(`/api/v1/tickets/${id}?messageCursor=${olderCursor}`);
      if (!mounted.current) return;
      const area = viewport.current;
      if (area) {
        const top = area.getBoundingClientRect().top;
        const visible = Array.from(area.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (message) => message.getBoundingClientRect().bottom > top,
        );
        anchor.current = {
          height: area.scrollHeight,
          top: area.scrollTop,
          messageId: visible?.dataset.messageId,
          offset: visible ? visible.getBoundingClientRect().top - top : undefined,
        };
      }
      followLatest.current = false;
      setMessages((current) => mergeMessages(previous.messages, current));
      setOlderCursor(previous.nextMessageCursor);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'پیام‌های قبلی دریافت نشد.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (
      sending.current ||
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

  async function loadHistory() {
    if (!activityCursor || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const previous = await request<Detail>(
        `/api/v1/tickets/${id}?activityCursor=${activityCursor}`,
      );
      setOlderActivities((current) => [...current, ...previous.activities]);
      setActivityCursor(previous.nextActivityCursor);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تاریخچه دریافت نشد.');
    } finally {
      setLoadingHistory(false);
    }
  }

  const activities = [
    ...new Map(
      [...olderActivities, ...data.activities].map((activity) => [activity.id, activity]),
    ).values(),
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id),
  );
  const counterpart =
    permissions.staff || permissions.readOnly ? ticket.creator.name : ticket.department.name;
  return (
    <div className="messenger-chat">
      <header className="messenger-header">
        <Link
          href={permissions.readOnly ? `/admin/departments/${ticket.departmentId}/history` : '/'}
          aria-label="بازگشت به گفتگوها"
          className="messenger-back"
        >
          <ArrowRight size={24} />
        </Link>
        <Avatar
          name={counterpart}
          image={permissions.staff || permissions.readOnly ? ticket.creator.image : null}
        />
        <div className="messenger-contact">
          <h1>{counterpart}</h1>
          <p>
            {permissions.staff || permissions.readOnly
              ? ticket.department.name
              : 'گفتگو با واحد دانشگاه'}
          </p>
        </div>
        <button
          type="button"
          className="messenger-info-button"
          aria-label="اطلاعات گفتگو"
          onClick={() => setInfo(true)}
        >
          <Info size={23} />
        </button>
      </header>
      {permissions.readOnly && (
        <p className="messenger-readonly">
          <Lock size={14} />
          مشاهده گفتگو توسط مدیر
        </p>
      )}
      <div className="messenger-message-area">
        <div
          ref={viewport}
          className="messenger-scroll"
          aria-label="پیام‌های گفتگو"
          tabIndex={0}
          onScroll={(event) => {
            const area = event.currentTarget;
            followLatest.current = area.scrollHeight - area.clientHeight - area.scrollTop < 100;
            if (followLatest.current) setNewMessages(false);
          }}
        >
          <div ref={stream} className="messenger-stream">
            {olderCursor && (
              <Button
                className="messenger-load-older"
                variant="outline"
                size="sm"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? <LoaderCircle size={16} className="messenger-loading" /> : null}
                {loadingOlder ? 'دریافت پیام‌ها…' : 'پیام‌های قبلی'}
              </Button>
            )}
            {!messages.length && (
              <div className="messenger-empty">
                <span>
                  <MessageCircle size={34} />
                </span>
                <h2>گفتگو با {ticket.department.name}</h2>
                <p>پیامتان را بنویسید، وویس ضبط کنید یا فایل بفرستید.</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={message.id}>
                {(!index || date(messages[index - 1].createdAt) !== date(message.createdAt)) && (
                  <div className="messenger-day">
                    <span>{date(message.createdAt)}</span>
                  </div>
                )}
                <article
                  data-message-id={message.id}
                  className={`messenger-bubble ${message.sender.id === actorId ? 'bubble-own' : ''} ${message.visibility === 'INTERNAL' ? 'bubble-private' : ''}`}
                >
                  {message.visibility === 'INTERNAL' && (
                    <span className="internal-label">
                      <Lock size={13} />
                      یادداشت خصوصی واحد
                    </span>
                  )}
                  <strong className="messenger-sender">
                    {message.sender.id === actorId ? 'شما' : message.sender.name}
                  </strong>
                  <p className="message-body">{message.body}</p>
                  <div className="message-attachments">
                    {message.attachments.map((file) => (
                      <AttachmentPreview key={file.id} file={file} />
                    ))}
                  </div>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {new Intl.DateTimeFormat('fa-IR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Tehran',
                    }).format(new Date(message.createdAt))}
                    {message.sender.id === actorId && <Check size={14} aria-label="ارسال شده" />}
                  </time>
                </article>
              </div>
            ))}
            {data.attachments.map((file) => (
              <AttachmentPreview file={file} key={file.id} />
            ))}
          </div>
        </div>
        {newMessages && (
          <Button
            type="button"
            className="messenger-jump"
            size="sm"
            onClick={() => {
              followLatest.current = true;
              viewport.current?.scrollTo({
                top: viewport.current.scrollHeight,
                behavior: 'smooth',
              });
              setNewMessages(false);
            }}
          >
            پیام جدید <ArrowDown size={16} />
          </Button>
        )}
      </div>
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
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  window.matchMedia('(pointer: fine)').matches
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button
              className="messenger-send"
              aria-label={pendingMessage ? 'تلاش دوباره برای ارسال' : 'ارسال پیام'}
              disabled={
                busy || recording || (!pendingMessage && !body.trim() && !files.length && !voice)
              }
            >
              <Send size={22} />
              <span>{busy ? 'ارسال…' : pendingMessage ? 'تلاش دوباره' : 'ارسال'}</span>
            </Button>
          </div>
          <div className="messenger-tools">
            <label className="messenger-attach">
              <Paperclip size={21} />
              عکس یا فایل
              <input
                id="attachment"
                type="file"
                multiple
                disabled={busy}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.webm,.ogg,.m4a,.mp3,.wav"
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
                key={recorderKey}
                onFile={setVoice}
                onRecordingChange={setRecording}
                maxSeconds={maxSeconds}
                maxBytes={maxBytes}
              />
            </fieldset>
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
        open={info}
        onOpenChange={setInfo}
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
            <dt>شروع گفتگو</dt>
            <dd>{date(ticket.createdAt)}</dd>
          </div>
        </dl>
        {(permissions.staff || permissions.readOnly) && (
          <details className="messenger-history">
            <summary>تاریخچه و یادداشت‌های واحد</summary>
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
                    onSaved={() => void refresh().catch(() => {})}
                  />
                )}
              </article>
            ))}
            {activityCursor && (
              <Button
                type="button"
                variant="outline"
                disabled={loadingHistory}
                onClick={() => void loadHistory()}
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
