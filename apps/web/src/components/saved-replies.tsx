'use client';

import { Select } from './ui/select';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Bookmark, FilePlus, Plus, Search, Send, Trash2, X } from 'lucide-react';
import type { listSavedReplies } from '@niticket/core/application/saved-replies';
import { request, digits } from '@/lib/utils';
import { uploadSavedReplyFile } from '@/lib/upload';
import { waitForAttachmentApproval } from '@/lib/attachment-approval';
import { useRealtimeSync } from '@/lib/use-realtime-sync';
import { clientCache, queryPolicy } from '@/lib/client-cache';
import { Modal } from './ui/dialog';
import { ModalForm } from './ui/modal-form';
import { PagedItems, PagedText } from './ui/paged-content';
import { Button } from './ui/button';
import { AttachmentPreview } from './attachment-preview';
import { VoiceRecorder } from './voice-recorder';
import { UploadProgress } from './upload-progress';

type ReplyList = Awaited<ReturnType<typeof listSavedReplies>>;
type Reply = ReplyList['items'][number];

function useReplyList(departmentId: string, initial?: ReplyList) {
  const warm = () => {
    const params = new URLSearchParams({ departmentId, q: '' });
    return clientCache.peek<ReplyList>(queryPolicy(`/api/v1/saved-replies?${params}`)!.key);
  };
  const [data, setData] = useState<ReplyList>(
    () => initial ?? warm() ?? { items: [], nextCursor: null },
  );
  const [query, setQuery] = useState(''),
    [loading, setLoading] = useState(() => !(initial ?? warm())),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor?: string) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          departmentId,
          q: query.trim(),
          ...(cursor ? { cursor } : {}),
        });
        const next = await request<ReplyList>(`/api/v1/saved-replies?${params}`, {
          signal: abort.signal,
        });
        if (!abort.signal.aborted)
          setData((previous) => ({
            ...next,
            items: cursor ? [...previous.items, ...next.items] : next.items,
          }));
      } catch (error) {
        if (!abort.signal.aborted)
          setError(error instanceof Error ? error.message : 'دریافت پیام‌ها انجام نشد.');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    },
    [departmentId, query],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [load]);
  useRealtimeSync(() => load(), ['saved-replies', 'catalog'], {
    initial: false,
    liveMs: 120000,
    fallbackMs: 30000,
  });
  return {
    data,
    query,
    setQuery: (value: string) => {
      if (value === query) return;
      controller.current?.abort();
      setLoading(true);
      setError('');
      setQuery(value);
    },
    loading,
    error,
    load,
  };
}

function ReplySearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="saved-reply-search">
      <Search size={18} />
      <span className="sr-only">جستجو در پیام‌های آماده</span>
      <input
        type="search"
        value={value}
        maxLength={100}
        placeholder="جستجو در پیام‌های آماده…"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ReplyContent({ reply }: { reply: Reply }) {
  const [media, setMedia] = useState(!reply.body);
  return (
    <div className="saved-reply-content">
      {!!reply.body && !!reply.attachments.length && (
        <div className="modal-form-tabs" role="group" aria-label="محتوای پیام آماده">
          <button type="button" aria-pressed={!media} onClick={() => setMedia(false)}>
            متن پیام
          </button>
          <button type="button" aria-pressed={media} onClick={() => setMedia(true)}>
            پیوست‌ها ({digits(reply.attachments.length)})
          </button>
        </div>
      )}
      {media ? (
        <PagedItems
          items={reply.attachments}
          pageSize={1}
          compactSize={1}
          label="پیوست‌های پیام"
          renderItem={(file) => <AttachmentPreview key={file.id} file={file} />}
        />
      ) : (
        <PagedText text={reply.body} />
      )}
    </div>
  );
}

function SavedReplyEditor({
  initial,
  departmentId,
  maxBytes,
  maxSeconds,
  onSaved,
  onClose,
}: {
  initial?: Reply;
  departmentId: string;
  maxBytes: number;
  maxSeconds: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [title, setTitle] = useState(initial?.title ?? ''),
    [body, setBody] = useState(initial?.body ?? '');
  const [existing, setExisting] = useState(initial?.attachments ?? []),
    [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]),
    [voice, setVoice] = useState<File | null>(null),
    [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState<number | null>(null),
    [filename, setFilename] = useState('');
  const [phase, setPhase] = useState<'saving' | 'uploading' | 'checking'>('saving');
  const [approved, setApproved] = useState({ count: 0, total: 0 });
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const saved = useRef(initial),
    clientId = useRef(crypto.randomUUID()),
    submitting = useRef(false);
  const retained = existing.filter((file) => !removed.includes(file.id));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || recording) return;
    if (!body.trim() && !retained.length && !files.length && !voice) {
      setError('متن، فایل یا یک پیام صوتی اضافه کنید.');
      return;
    }
    if (retained.length + files.length + (voice ? 1 : 0) > 5) {
      setError('هر پیام آماده حداکثر ۵ پیوست دارد.');
      return;
    }
    submitting.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setPhase('saving');
    setError('');
    try {
      const reply = saved.current
        ? await request<Reply>(`/api/v1/saved-replies/${saved.current.id}`, {
            method: 'PATCH',
            signal: controller.signal,
            body: JSON.stringify({
              title,
              body,
              version: saved.current.version,
              removeAttachmentIds: removed,
            }),
          })
        : await request<Reply>('/api/v1/saved-replies', {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify({ title, body, departmentId, clientId: clientId.current }),
          });
      controller.signal.throwIfAborted();
      saved.current = reply;
      setExisting(reply.attachments);
      setRemoved([]);
      for (const file of files) {
        setPhase('uploading');
        setFilename(file.name);
        setProgress(0);
        await uploadSavedReplyFile(file, reply.id, setProgress);
        controller.signal.throwIfAborted();
        const current = await request<Reply>(`/api/v1/saved-replies/${reply.id}`, {
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        saved.current = current;
        setExisting(current.attachments);
        setFiles((current) => current.filter((item) => item !== file));
      }
      if (voice) {
        setPhase('uploading');
        setFilename('پیام صوتی');
        setProgress(0);
        await uploadSavedReplyFile(voice, reply.id, setProgress);
        controller.signal.throwIfAborted();
        const current = await request<Reply>(`/api/v1/saved-replies/${reply.id}`, {
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        saved.current = current;
        setExisting(current.attachments);
        setVoice(null);
      }
      setProgress(null);
      setPhase('checking');
      const current = await request<Reply>(`/api/v1/saved-replies/${reply.id}`, {
        signal: controller.signal,
      });
      saved.current = current;
      setExisting(current.attachments);
      await waitForAttachmentApproval(
        current.attachments.map((file) => file.id),
        {
          signal: controller.signal,
          onProgress: (count, total) => setApproved({ count, total }),
        },
      );
      controller.signal.throwIfAborted();
      onSaved();
    } catch (error) {
      // An upload intent increments the reply version even if its completion
      // response is lost. Reconcile our own unchanged draft so the idempotent
      // upload can resume on retry, without overwriting another editor's changes.
      if (!controller.signal.aborted && saved.current) {
        try {
          const latest = await request<Reply>(`/api/v1/saved-replies/${saved.current.id}`, {
            signal: controller.signal,
          });
          if (latest.title === title.trim() && latest.body === body.trim()) saved.current = latest;
        } catch {
          // Keep the original upload/approval error if refreshing also fails.
        }
      }
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'ذخیره انجام نشد. دوباره تلاش کنید.');
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
      submitting.current = false;
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={initial ? 'ویرایش پیام آماده' : 'پیام آماده جدید'}
      description="متن، صدا و فایل را یک‌بار آماده کنید و در گفتگوهای واحد بفرستید."
    >
      <ModalForm
        className="saved-reply-editor"
        onSubmit={submit}
        disabled={busy}
        lockNavigation={recording}
        submitLabel="ذخیره پیام آماده"
        busyLabel={
          phase === 'checking'
            ? 'در حال بررسی پیوست‌ها…'
            : phase === 'uploading'
              ? 'در حال بارگذاری فایل‌ها…'
              : 'در حال ذخیره پیام…'
        }
        onCancel={onClose}
        sections={[
          {
            title: 'متن پیام',
            content: (
              <>
                <div className="field">
                  <label htmlFor={`${fieldId}-title`}>عنوان پیام آماده</label>
                  <input
                    id={`${fieldId}-title`}
                    autoFocus
                    required
                    value={title}
                    maxLength={100}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${fieldId}-body`}>متن پیام آماده</label>
                  <textarea
                    id={`${fieldId}-body`}
                    rows={5}
                    value={body}
                    maxLength={20000}
                    placeholder="متن پیام (اختیاری)…"
                    onChange={(event) => setBody(event.target.value)}
                  />
                </div>
              </>
            ),
          },
          {
            title: 'فایل‌ها',
            content: (
              <>
                <PagedItems
                  items={[
                    ...retained.map((file) => ({
                      id: file.id,
                      name: file.filename,
                      existing: true,
                    })),
                    ...files.map((file, index) => ({
                      id: String(index),
                      name: file.name,
                      existing: false,
                    })),
                  ]}
                  pageSize={4}
                  compactSize={1}
                  label="پیوست‌های پیام آماده"
                  disabled={busy}
                  renderItem={(file) => (
                    <div className="saved-reply-file" key={file.id}>
                      <bdi title={file.name}>{file.name}</bdi>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`حذف ${file.name}`}
                        onClick={() =>
                          file.existing
                            ? setRemoved((current) => [...current, file.id])
                            : setFiles((current) =>
                                current.filter((_, index) => index !== Number(file.id)),
                              )
                        }
                      >
                        <X size={17} />
                      </Button>
                    </div>
                  )}
                />
                <div className="saved-reply-add-media">
                  <label className="button button-outline">
                    <FilePlus size={17} />
                    افزودن فایل
                    <input
                      className="sr-only"
                      type="file"
                      multiple
                      aria-label="پیوست پیام آماده"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.webm,.ogg,.m4a,.mp4,.mp3,.wav"
                      onChange={(event) => {
                        const selected = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        if (selected.some((file) => file.size > maxBytes)) {
                          setError(
                            `حداکثر حجم هر فایل ${digits(Math.ceil(maxBytes / 1048576))} مگابایت است.`,
                          );
                          return;
                        }
                        if (
                          retained.length + files.length + selected.length + (voice ? 1 : 0) >
                          5
                        ) {
                          setError('هر پیام آماده حداکثر ۵ پیوست دارد.');
                          return;
                        }
                        setError('');
                        setFiles((current) => [...current, ...selected]);
                      }}
                    />
                  </label>
                  <small>عکس، ویدیو، صدا یا سند</small>
                </div>
              </>
            ),
          },
          {
            title: 'پیام صوتی',
            content: (
              <>
                <VoiceRecorder
                  onFile={setVoice}
                  onRecordingChange={setRecording}
                  maxBytes={maxBytes}
                  maxSeconds={maxSeconds}
                />
              </>
            ),
          },
        ]}
      >
        {busy && phase === 'checking' && (
          <p role="status" className="field-hint">
            بررسی امنیتی و آماده‌سازی فایل‌ها؛ {digits(approved.count)} از {digits(approved.total)}{' '}
            پیوست تأیید شده است.
          </p>
        )}
        {progress !== null && <UploadProgress percent={progress} filename={filename} />}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </ModalForm>
    </Modal>
  );
}

export function SavedReplyManager({
  departments,
  initial,
  initialDepartmentId,
  maxBytes,
  maxSeconds,
}: {
  departments: { id: string; name: string }[];
  initial: ReplyList;
  initialDepartmentId: string;
  maxBytes: number;
  maxSeconds: number;
}) {
  const [departmentId, setDepartmentId] = useState(initialDepartmentId);
  return (
    <div className="saved-replies-page">
      <Link href="/settings" className="saved-reply-back">
        <ArrowRight size={18} />
        تنظیمات
      </Link>
      <div className="page-heading">
        <div>
          <h1>پیام‌های آماده</h1>
          <p>پاسخ‌های پرکاربرد واحد را اینجا نگه دارید.</p>
        </div>
      </div>
      {departments.length > 1 && (
        <label className="field">
          <span>واحد</span>
          <Select
            aria-label="واحد"
            value={departmentId}
            onValueChange={setDepartmentId}
            options={departments.map((unit) => ({ value: unit.id, label: unit.name }))}
          />
        </label>
      )}
      {departmentId ? (
        <ManagedReplies
          key={departmentId}
          departmentId={departmentId}
          initial={departmentId === initialDepartmentId ? initial : undefined}
          maxBytes={maxBytes}
          maxSeconds={maxSeconds}
        />
      ) : (
        <p className="muted">هنوز به واحد فعالی دسترسی ندارید.</p>
      )}
    </div>
  );
}

function ManagedReplies({
  departmentId,
  initial,
  maxBytes,
  maxSeconds,
}: {
  departmentId: string;
  initial?: ReplyList;
  maxBytes: number;
  maxSeconds: number;
}) {
  const list = useReplyList(departmentId, initial);
  const [editor, setEditor] = useState<Reply | 'new' | null>(null),
    [deleting, setDeleting] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="surface saved-replies-panel" aria-label="فهرست پیام‌های آماده">
      <div className="saved-reply-toolbar">
        <ReplySearch value={list.query} onChange={list.setQuery} />
        <Button type="button" onClick={() => setEditor('new')}>
          <Plus size={17} />
          پیام جدید
        </Button>
      </div>
      {list.loading && <p role="status">در حال دریافت…</p>}
      {(error || list.error) && (
        <p role="alert" className="error-message">
          {error || list.error}
          <Button variant="ghost" onClick={() => void list.load()}>
            تازه‌سازی
          </Button>
        </p>
      )}
      {!list.loading && !list.error && !list.data.items.length && (
        <p className="saved-reply-empty">
          {list.query ? 'پیامی پیدا نشد.' : 'اولین پیام آماده واحد را اضافه کنید.'}
        </p>
      )}
      <ul className="saved-reply-list">
        {list.data.items.map((reply) => (
          <li key={reply.id}>
            <button
              type="button"
              className="saved-reply-summary"
              disabled={list.loading}
              onClick={() => setEditor(reply)}
              aria-label={`ویرایش ${reply.title}`}
            >
              <strong>{reply.title}</strong>
              <p>{reply.body || 'پیام دارای پیوست'}</p>
              {!!reply.attachments.length && (
                <small>{digits(reply.attachments.length)} پیوست</small>
              )}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`حذف ${reply.title}`}
              onClick={() => {
                setError('');
                setDeleting(reply);
              }}
            >
              <Trash2 size={17} />
            </Button>
          </li>
        ))}
      </ul>
      {list.data.nextCursor && (
        <Button
          type="button"
          variant="outline"
          disabled={list.loading}
          onClick={() => void list.load(list.data.nextCursor!)}
        >
          پیام‌های بیشتر
        </Button>
      )}
      {editor && (
        <SavedReplyEditor
          initial={editor === 'new' ? undefined : editor}
          departmentId={departmentId}
          maxBytes={maxBytes}
          maxSeconds={maxSeconds}
          onClose={() => {
            setEditor(null);
            void list.load();
          }}
          onSaved={() => {
            setEditor(null);
            void list.load();
          }}
        />
      )}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
        title="حذف پیام آماده"
        description="نسخه‌هایی که قبلاً در گفتگوها فرستاده‌اید باقی می‌مانند."
      >
        <p>{deleting?.title}</p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="saved-reply-actions">
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!deleting || busy) return;
              setBusy(true);
              setError('');
              try {
                await request(`/api/v1/saved-replies/${deleting.id}`, {
                  method: 'DELETE',
                  body: JSON.stringify({ version: deleting.version }),
                });
                setDeleting(null);
                await list.load();
              } catch (error) {
                setError(error instanceof Error ? error.message : 'حذف انجام نشد.');
              } finally {
                setBusy(false);
              }
            }}
          >
            حذف پیام آماده
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>
            انصراف
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function SavedReplyPicker({
  departmentId,
  onSend,
}: {
  departmentId: string;
  onSend: (id: string, version: number) => Promise<void>;
}) {
  const list = useReplyList(departmentId);
  const [selected, setSelected] = useState<Reply | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const waiting = selected?.attachments.some((file) =>
    ['PENDING', 'QUARANTINED'].includes(file.scanStatus),
  );
  const selectedId = selected?.id;
  useRealtimeSync(
    async () => {
      const reply = await request<Reply>(`/api/v1/saved-replies/${selectedId}`);
      setSelected((current) => (current?.id === reply.id ? reply : current));
    },
    ['saved-replies', 'attachments'],
    { enabled: !!selectedId && !!waiting },
  );
  const ready =
    selected &&
    (selected.body || selected.attachments.length) &&
    selected.attachments.every((file) => file.scanStatus === 'CLEAN');
  return (
    <div className="saved-reply-picker">
      <div hidden={!!selected} className="saved-reply-browser">
        <div className="saved-reply-toolbar">
          <ReplySearch
            value={list.query}
            onChange={(value) => {
              list.setQuery(value);
              setSelected(null);
              setError('');
            }}
          />
          <Link
            href={`/saved-replies?departmentId=${departmentId}`}
            className="saved-reply-manage-link"
          >
            مدیریت پیام‌ها
          </Link>
        </div>
        {list.loading && <p role="status">در حال دریافت…</p>}
        {(error || list.error) && (
          <p role="alert" className="error-message">
            {error || list.error}
          </p>
        )}
        {!list.loading && !list.error && !list.data.items.length && (
          <p className="saved-reply-empty">
            {list.query ? 'پیامی پیدا نشد.' : 'برای این واحد هنوز پیام آماده‌ای ندارید.'}
          </p>
        )}
        <PagedItems
          key={list.query}
          items={list.data.items}
          label="صفحه‌بندی پیام‌های آماده"
          disabled={busy || list.loading}
          renderItem={(reply) => (
            <div key={reply.id}>
              <button
                type="button"
                className="saved-reply-summary"
                aria-label={`انتخاب ${reply.title}`}
                disabled={busy || list.loading}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    setSelected(await request<Reply>(`/api/v1/saved-replies/${reply.id}`));
                  } catch (error) {
                    setError(error instanceof Error ? error.message : 'پیام دریافت نشد.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <strong>
                  <Bookmark size={15} />
                  {reply.title}
                </strong>
                <p>{reply.body || 'پیام دارای پیوست'}</p>
                {!!reply.attachments.length && (
                  <small>{digits(reply.attachments.length)} پیوست</small>
                )}
              </button>
            </div>
          )}
        />
        {list.data.nextCursor && (
          <Button
            type="button"
            variant="outline"
            disabled={list.loading || busy}
            onClick={() => void list.load(list.data.nextCursor!)}
          >
            پیام‌های بیشتر
          </Button>
        )}
      </div>
      {selected && (
        <section className="saved-reply-selection" aria-label="پیش‌نمایش پیام آماده">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setError('');
            }}
          >
            <ArrowRight size={16} /> بازگشت به پیام‌ها
          </Button>
          <h3>{selected.title}</h3>
          <ReplyContent reply={selected} />
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {!ready && (
            <p className="muted">
              پیش از ارسال، همه پیوست‌ها باید تأیید شوند. پیام خالی یا فایل ردشده را در بخش مدیریت
              ویرایش کنید.
            </p>
          )}
          <Button
            type="button"
            disabled={busy || !ready}
            aria-busy={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                await onSend(selected.id, selected.version);
              } catch (error) {
                setError(error instanceof Error ? error.message : 'ارسال انجام نشد.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Send size={17} />
            {busy ? 'در حال ارسال…' : 'ارسال پیام آماده'}
          </Button>
        </section>
      )}
    </div>
  );
}
