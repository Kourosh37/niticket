'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Check, Download, LoaderCircle, RotateCcw, X } from 'lucide-react';
import {
  type DownloadFile,
  subscribeDownloads,
  downloadFor,
  startDownload,
  cancelDownload,
  clearDownloads,
  downloadPercent,
  downloadSize,
} from '@/lib/downloads';

// Keep jobs alive across virtualized message rows, but isolate them to the signed-in user.
export function DownloadScope() {
  useEffect(() => () => clearDownloads(), []);
  return null;
}

export function DownloadButton({ file, full = false }: { file: DownloadFile; full?: boolean }) {
  const state = useSyncExternalStore(
    subscribeDownloads,
    () => downloadFor(file.id),
    () => null,
  );
  const busy = state?.status === 'queued' || state?.status === 'downloading';
  const retry = state?.status === 'cancelled' || state?.status === 'error';
  const Icon = busy ? X : retry ? RotateCcw : Download;
  const label = busy
    ? `لغو دریافت ${file.filename}`
    : retry
      ? `تلاش دوباره برای ${file.filename}`
      : `دریافت ${file.filename}`;
  return (
    <>
      <button
        type="button"
        className={full ? 'button button-outline download-full-button' : 'attachment-action'}
        aria-label={label}
        title={label}
        onClick={() => (busy ? cancelDownload(file.id) : startDownload(file))}
      >
        <Icon size={full ? 18 : 17} />
        {full && (busy ? 'لغو دریافت' : retry ? 'تلاش دوباره' : 'دریافت فایل اصلی')}
      </button>
      {state && (
        <div
          className={`download-inline download-${state.status}`}
          data-download-id={file.id}
          aria-label={`وضعیت دریافت ${file.filename}`}
        >
          <div className="download-inline-heading">
            <span role="status">
              {state.status === 'queued' ? (
                <>
                  <LoaderCircle size={13} className="download-spinner" /> در انتظار دریافت
                </>
              ) : state.status === 'downloading' ? (
                'در حال دریافت'
              ) : state.status === 'complete' ? (
                <>
                  <Check size={13} /> دریافت کامل شد
                </>
              ) : state.status === 'cancelled' ? (
                'دریافت لغو شد'
              ) : (
                'دریافت انجام نشد'
              )}
            </span>
            <span className="download-size" dir="ltr">
              {downloadSize(state)}
            </span>
          </div>
          {busy && (
            <div
              className={`download-progress-track${downloadPercent(state) === null ? ' download-indeterminate' : ''}`}
              role="progressbar"
              aria-label={`دریافت ${file.filename}`}
              aria-valuenow={downloadPercent(state) ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={downloadSize(state)}
            >
              <span style={{ width: `${downloadPercent(state) ?? 30}%` }} />
            </div>
          )}
          {state.error && (
            <p role="alert" className="download-error">
              {state.error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
