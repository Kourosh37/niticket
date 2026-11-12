'use client';

import { useEffect, useState } from 'react';
import type { AttachmentInfo } from './attachment-preview';
import { PdfPreview } from './pdf-preview';
import { MAX_PREVIEW_BYTES, previewBytes } from '@/lib/preview-bytes';
import { previewOffice } from '@/lib/office-preview';
import { mediaVersion } from '@/lib/media-cache';

export function DocumentPreview({ file, url }: { file: AttachmentInfo; url: string }) {
  if (file.detectedMime === 'application/pdf')
    return <PdfPreview key={url} url={url} size={file.size} />;
  return <TextDocumentPreview key={url} file={file} url={url} />;
}

function TextDocumentPreview({ file, url }: { file: AttachmentInfo; url: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  useEffect(() => {
    const abort = new AbortController();

    async function load() {
      try {
        if (file.size && file.size > MAX_PREVIEW_BYTES)
          throw new Error('این فایل برای پیش‌نمایش بزرگ است؛ آن را دریافت کنید.');
        const data = await previewBytes(url, abort.signal);
        if (abort.signal.aborted) return;
        if (
          file.detectedMime?.includes('wordprocessingml') ||
          file.detectedMime?.includes('spreadsheetml')
        ) {
          const result = await previewOffice(
            data,
            file.detectedMime,
            abort.signal,
            `${url}:${mediaVersion(url) ?? ''}`,
          );
          if (!abort.signal.aborted) {
            setText(result.text ?? '');
            setRows(result.rows ?? []);
          }
        } else if (file.detectedMime === 'text/plain') {
          setText(new TextDecoder('utf-8').decode(data).slice(0, 300000));
        } else throw new Error('پیش‌نمایش این قالب در دسترس نیست. فایل را دریافت کنید.');
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'پیش‌نمایش فایل انجام نشد.');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => abort.abort();
  }, [file.detectedMime, file.size, url]);

  return (
    <div className="document-preview">
      {loading && (
        <p role="status" className="muted">
          در حال آماده‌سازی پیش‌نمایش…
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {text && (
        <>
          <p className="field-hint">
            {file.detectedMime === 'text/plain'
              ? 'نمایش محتوای متنی فایل'
              : 'نمایش متنی سند ورد؛ برای قالب‌بندی اصلی، فایل را دریافت کنید.'}
          </p>
          <div
            className="document-text preview-scroll"
            role="region"
            aria-label="محتوای فایل"
            tabIndex={0}
          >
            {text}
          </div>
        </>
      )}
      {rows.length > 0 && (
        <>
          <p className="field-hint">نمایش برگه اول؛ حداکثر ۵۰۰ ردیف و ۳۰ ستون</p>
          <div
            className="spreadsheet-preview preview-scroll"
            role="region"
            aria-label="محتوای فایل"
            tabIndex={0}
          >
            <table>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
