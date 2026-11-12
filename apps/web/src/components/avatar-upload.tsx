'use client';

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { Avatar } from './avatar';
import { UploadProgress } from './upload-progress';
import { uploadAvatar } from '@/lib/upload';
import { request } from '@/lib/utils';

export function AvatarUpload({
  name,
  image,
  userId,
  onFileChange,
}: {
  name: string;
  image?: string | null;
  userId?: string;
  onFileChange?: (file: File | null) => void;
}) {
  const id = useId(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [percent, setPercent] = useState<number | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="avatar-editor">
      <div className="responsible-person">
        <Avatar name={name} image={image} />
        <div>
          <label
            htmlFor={id}
            className={`button button-outline button-sm ${busy ? 'disabled' : ''}`}
          >
            <Camera size={16} /> انتخاب تصویر پروفایل
          </label>
          <input
            className="sr-only"
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2097152) {
                setError('حجم تصویر حداکثر ۲ مگابایت باشد.');
                setMessage('');
                e.target.value = '';
                onFileChange?.(null);
                return;
              }
              if (onFileChange) {
                setError('');
                setMessage('تصویر انتخاب شد؛ پس از تأیید نهایی ذخیره می‌شود.');
                onFileChange(file);
                return;
              }
              setBusy(true);
              setPercent(0);
              setError('');
              setMessage('');
              try {
                const uploadId = await uploadAvatar(file, userId, setPercent);
                setMessage('تصویر بارگذاری شد و در حال بررسی است.');
                for (let attempt = 0; attempt < 30; attempt++) {
                  await new Promise((r) => setTimeout(r, 2000));
                  const status = await request<{ scanStatus: string }>(
                    `/api/v1/uploads/${uploadId}/status`,
                  );
                  if (status.scanStatus === 'REJECTED')
                    throw new Error('تصویر پذیرفته نشد. تصویر دیگری انتخاب کنید.');
                  if (status.scanStatus === 'CLEAN') {
                    setMessage('تصویر پروفایل به‌روزرسانی شد.');
                    setPercent(null);
                    router.refresh();
                    break;
                  }
                }
              } catch (error) {
                setError(error instanceof Error ? error.message : 'تصویر ذخیره نشد.');
              } finally {
                setBusy(false);
              }
            }}
          />
          <p className="field-hint">عکس واضح · حداکثر ۲ مگابایت</p>
        </div>
      </div>
      {percent !== null && <UploadProgress percent={percent} label="بارگذاری تصویر پروفایل" />}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
