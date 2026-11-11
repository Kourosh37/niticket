'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StickyNote, Lock } from 'lucide-react';
import { Modal } from './ui/dialog';
import { ModalForm } from './ui/modal-form';
import { Button } from './ui/button';
import { VoiceRecorder } from './voice-recorder';
import { UploadProgress } from './upload-progress';
import { request } from '@/lib/utils';
import { uploadFile } from '@/lib/upload';

export function HistoryNote({
  ticketId,
  activityId,
  maxSeconds,
  maxBytes,
  onSaved,
}: {
  ticketId: string;
  activityId: string;
  maxSeconds: number;
  maxBytes: number;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [body, setBody] = useState(''),
    [voice, setVoice] = useState<File | null>(null),
    [recording, setRecording] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [percent, setPercent] = useState<number | null>(null),
    [key, setKey] = useState(0);
  return (
    <>
      <button type="button" className="history-note-trigger" onClick={() => setOpen(true)}>
        <StickyNote size={13} /> یادداشت یا وویس
      </button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="یادداشت برای این رویداد"
        description="اختیاری؛ فقط مسئولان مجاز واحد و مدیر سامانه آن را می‌بینند."
      >
        <ModalForm
          disabled={busy}
          lockNavigation={recording}
          sections={[
            {
              title: 'یادداشت',
              content: (
                <div className="field">
                  <label htmlFor={`note-${activityId}`}>یادداشت متنی (اختیاری)</label>
                  <textarea
                    id={`note-${activityId}`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={4000}
                    disabled={busy || !!pending}
                    placeholder="جزئیات تکمیلی این مرحله از رسیدگی…"
                  />
                  <p className="field-hint">
                    <Lock size={12} style={{ display: 'inline' }} /> این یادداشت برای کاربر نمایش
                    داده نمی‌شود.
                  </p>
                </div>
              ),
            },
            {
              title: 'پیام صوتی',
              content: (
                <VoiceRecorder
                  key={key}
                  onFile={setVoice}
                  onRecordingChange={setRecording}
                  maxSeconds={maxSeconds}
                  maxBytes={maxBytes}
                />
              ),
            },
          ]}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || recording) return;
            setBusy(true);
            setError('');
            try {
              let id = pending;
              if (!id) {
                id = (
                  await request<{ id: string }>(
                    `/api/v1/tickets/${ticketId}/activities/${activityId}/notes`,
                    { method: 'POST', body: JSON.stringify({ body }) },
                  )
                ).id;
                setPending(id);
              }
              if (voice) {
                setPercent(0);
                await uploadFile(voice, ticketId, undefined, setPercent, id);
              }
              setPending(null);
              setBody('');
              setVoice(null);
              setPercent(null);
              setKey((k) => k + 1);
              setOpen(false);
              if (onSaved) onSaved();
              else router.refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'ثبت یادداشت انجام نشد.');
              if (onSaved) onSaved();
              else router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {percent !== null && <UploadProgress percent={percent} label="بارگذاری وویس یادداشت" />}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button disabled={busy || recording || (!body.trim() && !voice && !pending)}>
              {busy ? 'در حال ذخیره…' : pending ? 'تلاش دوباره برای وویس' : 'ثبت یادداشت'}
            </Button>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
