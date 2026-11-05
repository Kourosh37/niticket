'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Paperclip, ChevronLeft, Lock, RefreshCw, X, History, Check } from 'lucide-react';
import type { getTicket } from '@niticket/core/application/tickets';
import { transitions } from '@niticket/core/domain/workflow';
import { Button } from './ui/button';
import { Status } from './status';
import { VoiceRecorder } from './voice-recorder';
import { AttachmentPreview } from './attachment-preview';
import { UploadProgress } from './upload-progress';
import { Avatar } from './avatar';
import { HistoryNote } from './history-note';
import { request, date, dateTime, statusNames, priorityNames, digits } from '@/lib/utils';
import { uploadFile } from '@/lib/upload';

type Detail = Awaited<ReturnType<typeof getTicket>>;
const activityNames: Record<string, string> = {
  TICKET_CREATED: 'درخواست ثبت شد',
  PUBLIC_REPLY: 'پاسخ جدید ثبت شد',
  INTERNAL_NOTE: 'یادداشت داخلی ثبت شد',
  STATUS_CHANGED: 'وضعیت درخواست تغییر کرد',
  ASSIGNED: 'کارشناس درخواست تغییر کرد',
  TRANSFERRED: 'درخواست به واحد دیگری ارجاع شد',
  ATTACHMENT_READY: 'پیوست بررسی شد',
  PRIORITY_CHANGED: 'اولویت درخواست تغییر کرد',
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
    [status, setStatus] = useState(''),
    [tab, setTab] = useState<'conversation' | 'history'>('conversation');
  const hasPending = [
    ...detail.attachments,
    ...messages.flatMap((m) => m.attachments),
    ...detail.activities.flatMap((a) => a.notes.flatMap((n) => n.attachments)),
  ].some((a) => ['PENDING', 'QUARANTINED'].includes(a.scanStatus));
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [hasPending, router]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || recording) return;
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
      setSuccess('پیام شما ثبت شد. پیوست‌ها پس از بررسی امنیتی نمایش داده می‌شوند.');
      router.refresh();
    } catch (error) {
      setError(
        `${error instanceof Error ? error.message : 'ارسال انجام نشد.'}${savedId ? ' پیام ذخیره شده است؛ برای پیوست دوباره تلاش کنید.' : ''}`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(value: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request(`/api/v1/tickets/${ticket.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ version: ticket.version, status: value }),
      });
      setStatus('');
      setSuccess('وضعیت درخواست ذخیره شد.');
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تغییر وضعیت انجام نشد.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="breadcrumb">
        <Link
          href={
            permissions.readOnly
              ? `/admin/departments/${ticket.departmentId}/history`
              : permissions.staff
                ? '/workspace'
                : '/tickets'
          }
        >
          {permissions.readOnly
            ? 'تاریخچه واحد'
            : permissions.staff
              ? 'درخواست‌های واحد'
              : 'درخواست‌های من'}
        </Link>
        <ChevronLeft size={12} />
        <bdi dir="ltr">
          NIT-{new Date(ticket.createdAt).getUTCFullYear()}-{String(ticket.number).padStart(6, '0')}
        </bdi>
      </div>
      <div className="page-heading conversation-heading">
        <div>
          <h1>{ticket.subject}</h1>
          <p>
            {ticket.department.name} · ثبت‌شده در {date(ticket.createdAt)}
          </p>
        </div>
        <Status value={ticket.status} />
      </div>
      {permissions.readOnly && (
        <p className="readonly-notice">
          <History size={17} /> مشاهده تاریخچه توسط مدیر سامانه؛ ارسال پیام و تغییر وضعیت برای این
          حساب غیرفعال است.
        </p>
      )}
      <div className="conversation-layout">
        <section className="surface">
          <div className="conversation-tabs">
            <button
              type="button"
              className={tab === 'conversation' ? 'selected' : ''}
              onClick={() => setTab('conversation')}
            >
              گفتگو و پیوست‌ها
            </button>
            <button
              type="button"
              className={tab === 'history' ? 'selected' : ''}
              onClick={() => setTab('history')}
            >
              تاریخچه کامل
            </button>
            <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
              <RefreshCw size={14} /> تازه‌سازی
            </Button>
          </div>
          {tab === 'conversation' ? (
            <>
              <div className="messages">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message ${message.sender.id === actorId ? 'message-own' : ''} ${message.visibility === 'INTERNAL' ? 'message-internal' : ''}`}
                  >
                    {message.visibility === 'INTERNAL' && (
                      <span className="internal-label">
                        <Lock size={12} /> یادداشت داخلی واحد
                      </span>
                    )}
                    <div className="message-head">
                      <Avatar name={message.sender.name} image={message.sender.image} small />
                      <strong>{message.sender.name}</strong>
                      <time dateTime={new Date(message.createdAt).toISOString()}>
                        {dateTime(message.createdAt)}
                      </time>
                    </div>
                    <p className="message-body">{message.body}</p>
                    <div className="message-attachments">
                      {message.attachments.map((file) => (
                        <AttachmentPreview file={file} key={file.id} />
                      ))}
                    </div>
                  </article>
                ))}
                {detail.nextMessageCursor && (
                  <Button asChild variant="outline">
                    <Link href={`/tickets/${ticket.id}?messageCursor=${detail.nextMessageCursor}`}>
                      پیام‌های بعدی
                    </Link>
                  </Button>
                )}
                {detail.attachments.map((file) => (
                  <AttachmentPreview file={file} key={file.id} />
                ))}
              </div>
              {permissions.reply ? (
                <form className="composer" onSubmit={send}>
                  <label htmlFor="reply">
                    {pendingMessage ? 'تکمیل پیوست پیام ذخیره‌شده' : 'پاسخ شما'}
                  </label>
                  <textarea
                    id="reply"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={20000}
                    rows={4}
                    disabled={busy || !!pendingMessage}
                    placeholder={
                      visibility === 'INTERNAL'
                        ? 'یادداشتی برای واحد بنویسید…'
                        : 'پاسخ یا توضیحات خود را بنویسید…'
                    }
                  />
                  <div className="composer-tools-row">
                    <label htmlFor="attachment" className="button button-outline button-sm">
                      <Paperclip size={16} /> پیوست فایل
                    </label>
                    <input
                      className="sr-only"
                      id="attachment"
                      type="file"
                      multiple
                      disabled={busy}
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.webm,.ogg,.m4a,.mp3,.wav"
                      onChange={(e) => {
                        const chosen = Array.from(e.target.files ?? []);
                        if (chosen.some((f) => f.size > maxBytes)) {
                          setError(
                            `حجم هر فایل حداکثر ${digits(Math.round(maxBytes / 1048576))} مگابایت باشد.`,
                          );
                          return;
                        }
                        if (files.length + chosen.length > 5) {
                          setError('حداکثر ۵ فایل را در هر پیام بفرستید.');
                          return;
                        }
                        setFiles((current) => [...current, ...chosen]);
                        e.target.value = '';
                      }}
                    />
                    {permissions.staff && (
                      <select
                        aria-label="نوع پیام"
                        value={visibility}
                        disabled={busy || !!pendingMessage}
                        onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'INTERNAL')}
                      >
                        <option value="PUBLIC">پاسخ به دانشجو</option>
                        <option value="INTERNAL">یادداشت داخلی واحد</option>
                      </select>
                    )}
                    <span className="field-hint">
                      حداکثر هر فایل {digits(Math.round(maxBytes / 1048576))} مگابایت
                    </span>
                  </div>
                  {files.length > 0 && (
                    <div className="selected-files">
                      {files.map((file, index) => (
                        <span key={`${file.name}-${index}`}>
                          <Paperclip size={13} />
                          <bdi>{file.name}</bdi>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`حذف ${file.name}`}
                            onClick={() =>
                              setFiles((current) => current.filter((_, i) => i !== index))
                            }
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <VoiceRecorder
                    key={recorderKey}
                    onFile={setVoice}
                    onRecordingChange={setRecording}
                    maxSeconds={maxSeconds}
                    maxBytes={maxBytes}
                  />
                  {progress !== null && <UploadProgress percent={progress} filename={filename} />}
                  <div className="composer-bottom">
                    <small className="muted">
                      فایل و وویس پس از بررسی امنیتی در گفتگو نمایش داده می‌شوند.
                    </small>
                    <Button
                      disabled={
                        busy ||
                        recording ||
                        (!pendingMessage && !body.trim() && !files.length && !voice)
                      }
                    >
                      <Send size={16} />
                      {busy
                        ? 'در حال ارسال…'
                        : pendingMessage
                          ? 'تلاش دوباره برای پیوست'
                          : 'ارسال پاسخ'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="composer muted">
                  {permissions.readOnly
                    ? 'این گفتگو برای شما فقط قابل مشاهده است.'
                    : 'این درخواست بسته شده است.'}
                </div>
              )}
            </>
          ) : (
            <div className="full-history">
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
                          <Lock size={11} /> یادداشت واحد
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
            </div>
          )}
          {error && (
            <p role="alert" className="error-message" style={{ margin: 20 }}>
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="success-message" style={{ margin: 20 }}>
              {success}
            </p>
          )}
        </section>
        <aside className="detail-sidebar">
          <section className="surface">
            <h2>اطلاعات درخواست</h2>
            <dl className="detail-dl">
              <div>
                <dt>دانشجو</dt>
                <dd>{ticket.creator.name}</dd>
              </div>
              <div>
                <dt>واحد پاسخ‌گو</dt>
                <dd>{ticket.department.name}</dd>
              </div>
              <div>
                <dt>اولویت</dt>
                <dd>{priorityNames[ticket.priority]}</dd>
              </div>
              <div>
                <dt>آخرین فعالیت</dt>
                <dd>{date(ticket.lastActivityAt)}</dd>
              </div>
            </dl>
            {permissions.staff && transitions[ticket.status].length > 0 && (
              <>
                <label htmlFor="change-status">تغییر وضعیت</label>
                <select
                  id="change-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={busy}
                >
                  <option value="">وضعیت جدید را انتخاب کنید</option>
                  {transitions[ticket.status].map((s) => (
                    <option key={s} value={s}>
                      {statusNames[s]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !status}
                  onClick={() => void changeStatus(status)}
                >
                  ذخیره وضعیت
                </Button>
              </>
            )}
            {!permissions.staff &&
              !permissions.readOnly &&
              permissions.reopen &&
              ticket.status === 'RESOLVED' && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void changeStatus('REOPENED')}
                >
                  بازگشایی درخواست
                </Button>
              )}
          </section>
          <section className="surface">
            <h2>راهنمای پیگیری</h2>
            <p className="field-hint">
              {permissions.staff
                ? 'برای هر مرحله از رسیدگی، می‌توانید در بخش تاریخچه یک یادداشت یا وویس اختیاری ثبت کنید.'
                : 'پاسخ‌ها و پیوست‌ها در گفتگو نمایش داده می‌شوند. تغییرات وضعیت را در بخش تاریخچه کامل ببینید.'}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setTab('history')}>
              <History size={15} /> مشاهده تاریخچه
            </Button>
          </section>
        </aside>
      </div>
    </>
  );
}
