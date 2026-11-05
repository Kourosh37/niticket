'use client';

import { Check, CloudUpload } from 'lucide-react';
import { digits } from '@/lib/utils';

export function UploadProgress({
  percent,
  label = 'در حال بارگذاری',
  filename,
}: {
  percent: number;
  label?: string;
  filename?: string;
}) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div className="upload-progress-card" role="status">
      <span className="upload-progress-icon">
        {value === 100 ? <Check size={20} /> : <CloudUpload size={20} />}
      </span>
      <div className="upload-progress-content">
        <div className="upload-progress-label">
          <span>
            {label}
            {filename && (
              <>
                {' '}
                · <bdi>{filename}</bdi>
              </>
            )}
          </span>
          <strong>{digits(value)}٪</strong>
        </div>
        <div
          className="upload-progress-track"
          role="progressbar"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${value}%` }} />
        </div>
        <small>
          {value === 100
            ? 'بارگذاری انجام شد؛ بررسی امنیتی در حال انجام است.'
            : 'فایل شما در حال انتقال است؛ لطفاً این صفحه را باز نگه دارید.'}
        </small>
      </div>
    </div>
  );
}
