'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, ChevronUp, Download, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { Button } from './ui/button';
import { digits } from '@/lib/utils';
import {
  type DownloadFile,
  subscribeDownloads,
  getDownloads,
  getEmptyDownloads,
  downloadFor,
  startDownload,
  cancelDownload,
  dismissDownload,
  clearDownloads,
  downloadPercent,
  downloadSize,
} from '@/lib/downloads';

export function DownloadButton({ file, full = false }: { file: DownloadFile; full?: boolean }) {
  const state = useSyncExternalStore(
    subscribeDownloads,
    () => downloadFor(file.id),
    () => null,
  );
  const busy = state?.status === 'queued' || state?.status === 'downloading';
  const Icon = busy ? LoaderCircle : Download;
  if (full)
    return (
      <div className="download-full">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => startDownload(file)}
          aria-label={`دریافت ${file.filename}`}
        >
          <Icon size={16} className={busy ? 'download-spinner' : undefined} /> دریافت فایل اصلی
        </Button>
        {state && (
          <div className="download-inline" aria-label={`وضعیت دریافت ${file.filename}`}>
            <p className="download-size" dir="ltr">
              {downloadSize(state)}
            </p>
            {busy && (
              <>
                <div
                  className="download-progress-track"
                  role="progressbar"
                  aria-label={`دریافت ${file.filename}`}
                  aria-valuenow={downloadPercent(state) ?? undefined}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={downloadSize(state)}
                >
                  <span style={{ width: `${downloadPercent(state) ?? 30}%` }} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`لغو دریافت ${file.filename}`}
                  onClick={() => cancelDownload(file.id)}
                >
                  لغو دریافت
                </Button>
              </>
            )}
            {state.status === 'complete' && <small role="status">دریافت کامل شد</small>}
            {state.status === 'cancelled' && <small role="status">دریافت لغو شد</small>}
            {state.error && (
              <p role="alert" className="download-error">
                {state.error}
              </p>
            )}
          </div>
        )}
      </div>
    );
  return (
    <button
      className="attachment-action"
      type="button"
      disabled={busy}
      aria-busy={busy}
      aria-label={`دریافت ${file.filename}`}
      title={busy ? 'دریافت در حال انجام است' : 'دریافت فایل'}
      onClick={() => startDownload(file)}
    >
      <Icon size={17} className={busy ? 'download-spinner' : undefined} />
    </button>
  );
}

export function DownloadTray() {
  const items = useSyncExternalStore(subscribeDownloads, getDownloads, getEmptyDownloads);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => () => clearDownloads(), []);
  if (!items.length) return null;
  const pending = items.filter(
    (item) => item.status === 'queued' || item.status === 'downloading',
  ).length;
  return (
    <aside className="download-tray" aria-label="دریافت فایل‌ها">
      <div className="download-tray-heading">
        <strong>
          <Download size={17} />{' '}
          {pending ? `${digits(pending)} دریافت در حال انجام` : 'دریافت فایل‌ها'}
        </strong>
        <button
          type="button"
          aria-label={collapsed ? 'نمایش دریافت‌ها' : 'کوچک کردن دریافت‌ها'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>
      {!collapsed && (
        <div className="download-tray-items">
          {items.map((item) => {
            const percent = downloadPercent(item),
              size = downloadSize(item);
            const active = item.status === 'queued' || item.status === 'downloading';
            return (
              <div
                className={`download-item download-${item.status}`}
                data-download-id={item.id}
                key={item.id}
              >
                <div className="download-item-heading">
                  <bdi>{item.filename}</bdi>
                  <button
                    type="button"
                    aria-label={
                      active ? `لغو دریافت ${item.filename}` : `بستن دریافت ${item.filename}`
                    }
                    onClick={() => (active ? cancelDownload(item.id) : dismissDownload(item.id))}
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="download-item-status">
                  <span role="status">
                    {item.status === 'queued'
                      ? 'در انتظار دریافت'
                      : item.status === 'downloading'
                        ? 'در حال دریافت'
                        : item.status === 'complete'
                          ? 'دریافت کامل شد'
                          : item.status === 'cancelled'
                            ? 'دریافت لغو شد'
                            : 'دریافت انجام نشد'}
                  </span>
                  {percent !== null && (
                    <strong>
                      {item.status === 'complete' && <Check size={14} />}
                      {digits(percent)}٪
                    </strong>
                  )}
                </div>
                <p className="download-size" dir="ltr">
                  {size}
                </p>
                {active && (
                  <div
                    className="download-progress-track"
                    role="progressbar"
                    aria-label={`دریافت ${item.filename}`}
                    aria-valuenow={percent ?? undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={size}
                  >
                    <span style={{ width: `${percent ?? 30}%` }} />
                  </div>
                )}
                {item.error && (
                  <p role="alert" className="download-error">
                    {item.error}
                  </p>
                )}
                {(item.status === 'cancelled' || item.status === 'error') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`تلاش دوباره برای ${item.filename}`}
                    onClick={() => startDownload(item)}
                  >
                    <RotateCcw size={14} /> تلاش دوباره
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
