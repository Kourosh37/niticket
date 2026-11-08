'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowRight,
  Send,
  Paperclip,
  Lock,
  RefreshCw,
  X,
  History,
  Check,
  MessageCircle,
  Info,
} from 'lucide-react';
import type { getTicket } from '@niticket/core/application/tickets';
import { transitions } from '@niticket/core/domain/workflow';
import { Button } from './ui/button';
import { VoiceRecorder } from './voice-recorder';
import { AttachmentPreview } from './attachment-preview';
import { UploadProgress } from './upload-progress';
import { Avatar } from './avatar';
import { HistoryNote } from './history-note';
import { request, date, dateTime, statusNames, digits } from '@/lib/utils';
import { ticketState } from '@/lib/ticket-ui';
import { uploadFile } from '@/lib/upload';

type Detail = Awaited<ReturnType<typeof getTicket>>;
const activityNames: Record<string, string> = {
  TICKET_CREATED: 'درخواست ثبت شد',
  PUBLIC_REPLY: 'پیام جدید ارسال شد',
  INTERNAL_NOTE: 'یادداشت خصوصی ثبت شد',
  STATUS_CHANGED: 'وضعیت رسیدگی تغییر کرد',
  ASSIGNED: 'مسئول درخواست تغییر کرد',
  TRANSFERRED: 'درخواست به واحد دیگری فرستاده شد',
  ATTACHMENT_READY: 'پیوست آماده شد',
  PRIORITY_CHANGED: 'اولویت تغییر کرد',
};
const actionNames: Record<string, string> = {
  IN_PROGRESS: 'شروع رسیدگی',
  WAITING_FOR_USER: 'منتظر پاسخ فرستنده',
  WAITING_FOR_DEPARTMENT: 'پیگیری از واحد دیگر',
  RESOLVED: 'پایان رسیدگی',
  REOPENED: 'ادامه رسیدگی',
  CLOSED: 'بستن نهایی گفتگو',
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
  const router = useRouter();
  const params = useSearchParams();
  const { ticket, messages, permissions } = detail;
  const [body, setBody] = useState(''),
    [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC'),
    [files, setFiles] = useState<File[]>([]),
    [voice, setVoice] = useState<File | null>(null),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [progress, setProgress] = useState<number | null>(null),
    [filename, setFilename] = useState(''),
    [pendingMessage, setPendingMessage] = useState<string | null>(null),
    [recorderKey, setRecorderKey] = useState(0),
    [tab, setTab] = useState<'conversation' | 'history'>('conversation'),
    [newMessage, setNewMessage] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    nearBottom = useRef(true),
    firstView = useRef(true),
    sending = useRef(false);
  const lastMessageId = messages.at(-1)?.id;
  const olderPage = !!params.get('messageCursor');
  useEffect(() => {
    const onScroll = () => {
      nearBottom.current =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 350;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (tab !== 'conversation') return;
    if (firstView.current || nearBottom.current) {
      bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
      setNewMessage(false);
    } else setNewMessage(true);
    firstView.current = false;
  }, [lastMessageId, tab]);
  useEffect(() => {
    if (busy || recording) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [busy, recording, router]);
  const hasPending = [
    ...detail.attachments,
    ...messages.flatMap((m) => m.attachments),
    ...detail.activities.flatMap((a) => a.notes.flatMap((n) => n.attachments)),
  ].some((a) => ['PENDING', 'QUARANTINED'].includes(a.scanStatus));
  useEffect(() => {
    if (!hasPending || busy || recording) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasPending, busy, recording, router]);

  function refreshLatest() {
    nearBottom.current = true;
    if (olderPage) router.replace(`/tickets/${ticket.id}`);
    router.refresh();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (
      sending.current ||
      recording ||
      (!pendingMessage && !body.trim() && !files.length && !voice)
    )
      return;
    sending.current = true;
    setError('');
    setSuccess('');
    setBusy(true);
    let savedId = pendingMessage;
    try {
      if (!savedId) {
        savedId = (
          await request<{ id: string }>(`/api/v1/tickets/${ticket.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
              version: ticket.version,
              body: body.trim() || 'پیوست ارسال شد.',
              visibility,
            }),
          })
        ).id;
        if (permissions.staff && visibility === 'PUBLIC')
          window.dispatchEvent(new Event('notifications:changed'));
        setPendingMessage(savedId);
        setBody('');
      }
      for (const file of files) {
        setFilename(file.name);
        setProgress(0);
        await uploadFile(file, ticket.id, savedId, setProgress);
        setFiles((current) => current.filter((item) => item !== file));
      }
      if (voice) {
        setFilename('پیام صوتی');
        setProgress(0);
        await uploadFile(voice, ticket.id, savedId, setProgress);
        setVoice(null);
        setRecorderKey((k) => k + 1);
      }
      setPendingMessage(null);
      setProgress(null);
      setSuccess('ارسال شد');
      refreshLatest();
      input.current?.focus();
    } catch (error) {
      setError(
        `${error instanceof Error ? error.message : 'ارسال انجام نشد.'}${savedId ? ' متن پیام ذخیره شد. برای ارسال فایل‌ها دوباره بزنید.' : ''}`,
      );
      router.refresh();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function changeStatus(value: string) {
    if (sending.current || recording) return;
    sending.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request(`/api/v1/tickets/${ticket.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ version: ticket.version, status: value }),
      });
      setSuccess('وضعیت رسیدگی تغییر کرد.');
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تغییر وضعیت انجام نشد.');
      router.refresh();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const back = permissions.readOnly ? `/admin/departments/${ticket.departmentId}/history` : '/';
  return (
    <div className="easy-chat">
      <header className="chat-heading conversation-heading">
        <Link href={back} className="chat-back" aria-label="بازگشت به گفتگوها">
          <ArrowRight size={24} />
        </Link>
        <Avatar
          name={
            permissions.staff || permissions.readOnly ? ticket.creator.name : ticket.department.name
          }
          image={permissions.staff || permissions.readOnly ? ticket.creator.image : null}
        />
        <div className="chat-title">
          <span>
            {permissions.staff || permissions.readOnly
              ? ticket.creator.name
              : ticket.department.name}
          </span>
          <h1 title={ticket.subject}>{ticket.subject}</h1>
          <span className={`status chat-state status-${ticket.status.toLowerCase()}`}>
            <i />
            {ticketState(ticket.status, permissions.staff)}
          </span>
        </div>
        <details className="chat-info">
          <summary aria-label="اطلاعات درخواست">
            <Info size={22} />
          </summary>
          <div>
            <strong>اطلاعات درخواست</strong>
            <p>موضوع: {ticket.subject}</p>
            <p>واحد: {ticket.department.name}</p>
            <p>فرستنده: {ticket.creator.name}</p>
            <p>تاریخ: {date(ticket.createdAt)}</p>
            <bdi dir="ltr">
              NIT-{new Date(ticket.createdAt).getUTCFullYear()}-
              {String(ticket.number).padStart(6, '0')}
            </bdi>
          </div>
        </details>
      </header>
      {permissions.readOnly && (
        <p className="chat-notice">
          <Lock size={16} /> این گفتگو برای مدیر فقط قابل مشاهده است.
        </p>
      )}
      {permissions.staff && transitions[ticket.status].length > 0 && (
        <div className="chat-workflow" aria-label="رسیدگی به درخواست">
          <span>رسیدگی:</span>
          {transitions[ticket.status]
            .filter((s) => s !== 'CLOSED')
            .map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={s === 'RESOLVED' ? 'default' : 'outline'}
                disabled={busy || recording}
                onClick={() => void changeStatus(s)}
              >
                {s === 'RESOLVED' && <Check size={17} />}
                {actionNames[s]}
              </Button>
            ))}
          {transitions[ticket.status].includes('CLOSED') && (
            <details className="chat-close-option">
              <summary>بستن گفتگو</summary>
              <p>پس از بستن نهایی، دیگر نمی‌توان در این گفتگو پیام فرستاد.</p>
              <Button
                variant="outline"
                disabled={busy || recording}
                onClick={() => void changeStatus('CLOSED')}
              >
                بستن نهایی گفتگو
              </Button>
            </details>
          )}
        </div>
      )}
      <div
        className="chat-tabs"
        role="tablist"
        aria-label="بخش‌های درخواست"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).getAttribute('role') !== 'tab' || busy || recording)
            return;
          const next =
            event.key === 'ArrowLeft' || event.key === 'End'
              ? 'history'
              : event.key === 'ArrowRight' || event.key === 'Home'
                ? 'conversation'
                : null;
          if (!next) return;
          event.preventDefault();
          setTab(next);
          document.getElementById(next === 'history' ? 'history-tab' : 'conversation-tab')?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id="conversation-tab"
          aria-controls="conversation-panel"
          aria-selected={tab === 'conversation'}
          tabIndex={tab === 'conversation' ? 0 : -1}
          onClick={() => setTab('conversation')}
        >
          <MessageCircle size={18} />
          گفتگو
        </button>
        <button
          type="button"
          role="tab"
          id="history-tab"
          aria-controls="history-panel"
          aria-selected={tab === 'history'}
          tabIndex={tab === 'history' ? 0 : -1}
          disabled={busy || recording}
          onClick={() => setTab('history')}
        >
          <History size={17} />
          تاریخچه کامل
        </button>
        <button
          type="button"
          className="chat-refresh"
          aria-label="تازه‌سازی گفتگو"
          onClick={() => router.refresh()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {tab === 'conversation' ? (
        <section role="tabpanel" id="conversation-panel" aria-labelledby="conversation-tab">
          <div className="chat-messages messages" aria-label="پیام‌های گفتگو">
            {olderPage && (
              <Link className="chat-older" href={`/tickets/${ticket.id}`}>
                بازگشت به آخرین پیام‌ها <ArrowDown size={17} />
              </Link>
            )}
            {detail.nextMessageCursor && (
              <Link
                className="chat-older"
                href={`/tickets/${ticket.id}?messageCursor=${detail.nextMessageCursor}`}
              >
                پیام‌های قبلی
              </Link>
            )}
            {messages.map((message, index) => {
              const own = message.sender.id === actorId;
              const newDay =
                !index || date(messages[index - 1].createdAt) !== date(message.createdAt);
              return (
                <div key={message.id}>
                  {newDay && (
                    <div className="chat-day">
                      <span>{date(message.createdAt)}</span>
                    </div>
                  )}
                  <article
                    className={`message chat-bubble ${own ? 'message-own' : ''} ${message.visibility === 'INTERNAL' ? 'message-internal' : ''}`}
                  >
                    {message.visibility === 'INTERNAL' && (
                      <span className="internal-label">
                        <Lock size={13} />
                        یادداشت خصوصی واحد
                      </span>
                    )}
                    <strong className="chat-sender">{own ? 'شما' : message.sender.name}</strong>
                    <p className="message-body">{message.body}</p>
                    <div className="message-attachments">
                      {message.attachments.map((file) => (
                        <AttachmentPreview file={file} key={file.id} />
                      ))}
                    </div>
                    <time dateTime={new Date(message.createdAt).toISOString()}>
                      {new Intl.DateTimeFormat('fa-IR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Tehran',
                      }).format(new Date(message.createdAt))}
                      {own && <Check size={13} aria-label="ارسال شده" />}
                    </time>
                  </article>
                </div>
              );
            })}
            {detail.attachments.map((file) => (
              <AttachmentPreview file={file} key={file.id} />
            ))}
            <div ref={bottom} className="chat-bottom-anchor" />
          </div>
          {newMessage && (
            <Button
              className="chat-new-message"
              size="sm"
              onClick={() => {
                bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                setNewMessage(false);
              }}
            >
              پیام جدید <ArrowDown size={16} />
            </Button>
          )}
          {permissions.reply ? (
            <form
              className={`chat-composer ${visibility === 'INTERNAL' ? 'composer-private' : ''}`}
              onSubmit={send}
            >
              {permissions.staff && (
                <div className="composer-visibility" aria-label="نوع پیام">
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
                <p className="private-composer-notice">
                  <Lock size={14} />
                  این پیام را فقط مسئولان واحد و مدیر می‌بینند.
                </p>
              )}
              {pendingMessage && (
                <p className="composer-saved">پیام ذخیره شده؛ ارسال فایل‌ها را تکمیل کنید.</p>
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
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      >
                        <X size={16} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="composer-input-row">
                <label htmlFor="reply" className="sr-only">
                  پاسخ شما
                </label>
                <textarea
                  ref={input}
                  id="reply"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={20000}
                  rows={2}
                  disabled={busy || !!pendingMessage}
                  placeholder={
                    visibility === 'INTERNAL' ? 'یادداشت خصوصی بنویسید…' : 'پیام خود را بنویسید…'
                  }
                />
                <Button
                  className="chat-send"
                  disabled={
                    busy ||
                    recording ||
                    (!pendingMessage && !body.trim() && !files.length && !voice)
                  }
                >
                  <Send size={21} />
                  <span>{busy ? 'ارسال…' : pendingMessage ? 'تلاش دوباره' : 'ارسال پاسخ'}</span>
                </Button>
              </div>
              <div className="composer-tools">
                <label htmlFor="attachment" className="chat-attach" aria-disabled={busy}>
                  <Paperclip size={21} />
                  عکس یا فایل
                  <input
                    id="attachment"
                    type="file"
                    multiple
                    disabled={busy}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.webm,.ogg,.m4a,.mp3,.wav"
                    onChange={(e) => {
                      const chosen = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (chosen.some((f) => f.size > maxBytes)) {
                        setError(
                          `حجم هر فایل حداکثر ${digits(Math.round(maxBytes / 1048576))} مگابایت باشد.`,
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
                <fieldset disabled={busy} className="composer-voice">
                  <VoiceRecorder
                    key={recorderKey}
                    onFile={setVoice}
                    onRecordingChange={setRecording}
                    maxSeconds={maxSeconds}
                    maxBytes={maxBytes}
                  />
                </fieldset>
              </div>
              {progress !== null && <UploadProgress percent={progress} filename={filename} />}
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
              {success && (
                <p role="status" className="chat-send-status">
                  <Check size={14} />
                  {success}
                </p>
              )}
            </form>
          ) : (
            <div className="chat-ended">
              <Lock size={19} />
              <p>
                {permissions.readOnly ? 'گفتگو فقط قابل مشاهده است.' : 'این گفتگو بسته شده است.'}
              </p>
            </div>
          )}
          {!permissions.staff &&
            !permissions.readOnly &&
            permissions.reopen &&
            ticket.status === 'RESOLVED' && (
              <div className="chat-reopen">
                <p>هنوز به کمک نیاز دارید؟</p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void changeStatus('REOPENED')}
                >
                  ادامه همین درخواست
                </Button>
              </div>
            )}
        </section>
      ) : (
        <section
          role="tabpanel"
          id="history-panel"
          aria-labelledby="history-tab"
          className="chat-history"
        >
          <p className="history-intro">مراحل رسیدگی به درخواست شما</p>
          {detail.activities.map((activity) => (
            <article className="history-event" key={activity.id}>
              <div className="history-event-title">
                <span className="history-event-dot">
                  <Check size={13} />
                </span>
                <strong>{activityNames[activity.type] ?? 'درخواست به‌روزرسانی شد'}</strong>
                <time>{dateTime(activity.createdAt)}</time>
              </div>
              {activity.type === 'STATUS_CHANGED' &&
                activity.metadata &&
                typeof activity.metadata === 'object' &&
                !Array.isArray(activity.metadata) && (
                  <p className="history-state-change">
                    {statusNames[String(activity.metadata.from)]} ←{' '}
                    {statusNames[String(activity.metadata.to)]}
                  </p>
                )}
              {activity.notes.map((note) => (
                <div className="history-note" key={note.id}>
                  <div className="message-head">
                    <Avatar name={note.author.name} image={note.author.image} small />
                    <strong>{note.author.name}</strong>
                    <span className="internal-label">
                      <Lock size={12} />
                      یادداشت خصوصی
                    </span>
                  </div>
                  {note.body && <p className="message-body">{note.body}</p>}
                  {note.attachments.map((file) => (
                    <AttachmentPreview file={file} key={file.id} />
                  ))}
                </div>
              ))}
              {permissions.staff && (
                <HistoryNote
                  ticketId={ticket.id}
                  activityId={activity.id}
                  maxSeconds={maxSeconds}
                  maxBytes={maxBytes}
                />
              )}
            </article>
          ))}
          {detail.nextActivityCursor && (
            <Button asChild variant="outline">
              <Link href={`/tickets/${ticket.id}?activityCursor=${detail.nextActivityCursor}`}>
                رویدادهای قبلی
              </Link>
            </Button>
          )}
        </section>
      )}
      {error && tab !== 'conversation' && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
