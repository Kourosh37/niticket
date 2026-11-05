'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { request } from '@/lib/utils';
import { Button } from './ui/button';
import { useReauthentication } from './reauthentication';
import type { settings } from '@niticket/core/application/settings';

export function AdminSettings({ policy }: { policy: Awaited<ReturnType<typeof settings>> }) {
  const router = useRouter();
  const reauthentication = useReauthentication();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>اطلاعات و تنظیمات سامانه</h1>
          <p>مشخصات عمومی و محدودیت‌های فایل و صدا را مدیریت کنید.</p>
        </div>
      </div>
      <form
        className="surface form-surface"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          const f = new FormData(e.currentTarget);
          try {
            await reauthentication.run(() =>
              request('/api/v1/admin/settings', {
                method: 'PATCH',
                body: JSON.stringify({
                  universityName: f.get('universityName'),
                  supportDescription: f.get('supportDescription'),
                  studentEmailDomains: String(f.get('studentEmailDomains'))
                    .split(/[,،\s]+/)
                    .filter(Boolean),
                  reopenDays: Number(f.get('reopenDays')),
                  maxUploadBytes: Number(f.get('megabytes')) * 1048576,
                  maxVoiceSeconds: Number(f.get('maxVoiceSeconds')),
                  allowUserUrgent: false,
                }),
              }),
            );
            setSuccess('اطلاعات سامانه ذخیره شد.');
            router.refresh();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'ذخیره اطلاعات انجام نشد.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="form-fields" disabled={busy}>
          <div className="field">
            <label htmlFor="universityName">نام دانشگاه</label>
            <input
              id="universityName"
              name="universityName"
              defaultValue={policy.universityName}
              required
              minLength={2}
              maxLength={150}
            />
          </div>
          <div className="field">
            <label htmlFor="supportDescription">توضیح کوتاه سامانه</label>
            <textarea
              id="supportDescription"
              name="supportDescription"
              defaultValue={policy.supportDescription}
              maxLength={1000}
            />
          </div>
          <div className="field">
            <label htmlFor="studentEmailDomains">دامنه مجاز ایمیل دانشجویی</label>
            <input
              id="studentEmailDomains"
              name="studentEmailDomains"
              dir="ltr"
              required
              defaultValue={policy.studentEmailDomains.join(', ')}
            />
            <p className="field-hint">
              دامنه تأییدشده: stu.nit.ac.ir. در صورت نیاز، چند دامنه را با ویرگول جدا کنید.
            </p>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="megabytes">حداکثر حجم پیوست (مگابایت)</label>
              <input
                id="megabytes"
                name="megabytes"
                type="number"
                min={1}
                max={50}
                required
                defaultValue={policy.maxUploadBytes / 1048576}
              />
            </div>
            <div className="field">
              <label htmlFor="maxVoiceSeconds">حداکثر مدت وویس (ثانیه)</label>
              <input
                id="maxVoiceSeconds"
                name="maxVoiceSeconds"
                type="number"
                min={10}
                max={600}
                required
                defaultValue={policy.maxVoiceSeconds}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reopenDays">مهلت بازگشایی درخواست حل‌شده (روز)</label>
            <input
              id="reopenDays"
              name="reopenDays"
              type="number"
              min={0}
              max={365}
              required
              defaultValue={policy.reopenDays}
            />
          </div>
        </fieldset>
        {reauthentication.confirmation}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="success-message">
            {success}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیره اطلاعات سامانه'}</Button>
        </div>
      </form>
    </>
  );
}
