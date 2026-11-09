'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { FileText, ImageIcon, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';
import { AudioPlayer } from './audio-player';
import { DownloadButton } from './downloads';
import { formatFileSize } from '@/lib/downloads';
import { digits, checkSession } from '@/lib/utils';

export type AttachmentInfo = {
  id: string;
  filename: string;
  detectedMime: string | null;
  scanStatus: string;
  size?: number | null;
  durationSeconds?: number | null;
  waveform?: unknown;
};

const MAX_PREVIEW_BYTES = 20971520;

async function previewBytes(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  checkSession(response);
  if (!response.ok) throw new Error('اجازه مشاهده فایل وجود ندارد.');
  if (Number(response.headers.get('content-length')) > MAX_PREVIEW_BYTES) {
    await response.body?.cancel();
    throw new Error('این فایل برای پیش‌نمایش بزرگ است؛ آن را دریافت کنید.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('دریافت فایل انجام نشد.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PREVIEW_BYTES) {
      await reader.cancel();
      throw new Error('این فایل برای پیش‌نمایش بزرگ است؛ آن را دریافت کنید.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

function DocumentPreview({ file, url }: { file: AttachmentInfo; url: string }) {
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [rows, setRows] = useState<string[][]>([]),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdfSource = useRef<{
    task: PDFDocumentLoadingTask;
    document: Promise<PDFDocumentProxy>;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    let rendering: { cancel: () => void } | undefined;

    async function load() {
      try {
        if (file.size && file.size > MAX_PREVIEW_BYTES)
          throw new Error('این فایل برای پیش‌نمایش بزرگ است؛ آن را دریافت کنید.');
        const data =
          file.detectedMime === 'application/pdf' && pdfSource.current
            ? null
            : await previewBytes(url, abort.signal);
        if (!active) return;
        if (file.detectedMime === 'application/pdf') {
          if (!pdfSource.current) {
            const pdfjs = await import('pdfjs-dist');
            if (!active) return;
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            const loadingTask = pdfjs.getDocument({
              data: new Uint8Array(data!),
              useSystemFonts: true,
              cMapUrl: '/pdf-assets/cmaps/',
              cMapPacked: true,
              standardFontDataUrl: '/pdf-assets/standard_fonts/',
              wasmUrl: '/pdf-assets/wasm/',
            });
            pdfSource.current = { task: loadingTask, document: loadingTask.promise };
          }
          const pdf = await pdfSource.current.document;
          if (!active) return;
          setPages(pdf.numPages);
          const p = await pdf.getPage(Math.min(page, pdf.numPages));
          if (!active) return;
          const initial = p.getViewport({ scale: 1 });
          const width = Math.min(750, window.innerWidth - 90);
          const viewport = p.getViewport({ scale: width / initial.width });
          const target = canvas.current;
          if (!target) return;
          target.width = viewport.width;
          target.height = viewport.height;
          const render = p.render({ canvas: target, viewport });
          rendering = render;
          await render.promise;
        } else if (file.detectedMime?.includes('wordprocessingml')) {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ arrayBuffer: data! });
          if (active) setText(result.value.slice(0, 300000));
        } else if (file.detectedMime?.includes('spreadsheetml')) {
          const { readSheet: read } = await import('read-excel-file/browser');
          const values = await read(new Blob([data!]));
          if (active)
            setRows(
              values
                .slice(0, 500)
                .map((row) =>
                  row
                    .slice(0, 30)
                    .map((value) =>
                      value instanceof Date
                        ? new Intl.DateTimeFormat('fa-IR').format(value)
                        : String(value ?? ''),
                    ),
                ),
            );
        } else if (file.detectedMime === 'text/plain') {
          if (active) setText(new TextDecoder('utf-8').decode(data!).slice(0, 300000));
        } else throw new Error('پیش‌نمایش این قالب در دسترس نیست. فایل را دریافت کنید.');
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError'))
          setError(error instanceof Error ? error.message : 'پیش‌نمایش فایل انجام نشد.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      abort.abort();
      rendering?.cancel();
    };
  }, [file.detectedMime, file.size, url, page]);
  useEffect(
    () => () => {
      void pdfSource.current?.task.destroy();
      pdfSource.current = null;
    },
    [url],
  );
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
      {file.detectedMime === 'application/pdf' && (
        <>
          <canvas ref={canvas} aria-label={`صفحه ${digits(page)} فایل پی‌دی‌اف`} />
          {pages > 1 && (
            <div className="preview-pagination">
              <Button
                variant="outline"
                size="icon"
                aria-label="صفحه قبلی"
                disabled={page <= 1 || loading}
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setPage((p) => p - 1);
                }}
              >
                <ChevronRight size={17} />
              </Button>
              <span>
                صفحه {digits(page)} از {digits(pages)}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="صفحه بعدی"
                disabled={page >= pages || loading}
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setPage((p) => p + 1);
                }}
              >
                <ChevronLeft size={17} />
              </Button>
            </div>
          )}
        </>
      )}
      {text && (
        <>
          <p className="field-hint">
            {file.detectedMime === 'text/plain'
              ? 'نمایش محتوای متنی فایل'
              : 'نمایش متنی سند ورد؛ برای قالب‌بندی اصلی، فایل را دریافت کنید.'}
          </p>
          <div className="document-text">{text}</div>
        </>
      )}
      {rows.length > 0 && (
        <>
          <p className="field-hint">نمایش برگه اول؛ حداکثر ۵۰۰ ردیف و ۳۰ ستون</p>
          <div className="spreadsheet-preview">
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

export function AttachmentPreview({ file }: { file: AttachmentInfo }) {
  const [open, setOpen] = useState(false);
  const url = `/api/v1/attachments/${file.id}/access`;
  if (file.scanStatus !== 'CLEAN')
    return (
      <div
        className={`attachment processing-attachment ${file.scanStatus === 'REJECTED' ? 'rejected' : ''}`}
      >
        <FileText size={18} />
        <bdi>{file.filename}</bdi>
        <small>
          {file.scanStatus === 'REJECTED' ? 'فایل پذیرفته نشد' : 'در انتظار بررسی امنیتی'}
        </small>
      </div>
    );
  if (file.detectedMime?.startsWith('audio/'))
    return (
      <div className="audio-attachment">
        <AudioPlayer src={url} durationSeconds={file.durationSeconds} waveform={file.waveform} />
        <DownloadButton file={file} />
      </div>
    );
  const image = file.detectedMime?.startsWith('image/');
  return (
    <>
      <div className="attachment-card">
        {image && (
          <button
            type="button"
            className="attachment-thumbnail"
            aria-label={`پیش‌نمایش ${file.filename}`}
            onClick={() => setOpen(true)}
          >
            <Image
              src={url}
              unoptimized
              alt={file.filename}
              loading="lazy"
              decoding="async"
              width={300}
              height={180}
              style={{ objectFit: 'cover', width: '100%', height: '100%' }}
            />
          </button>
        )}
        <div className="attachment-card-meta">
          {image ? <ImageIcon size={20} /> : <FileText size={20} />}
          <div>
            <bdi>{file.filename}</bdi>
            {file.size && <small dir="ltr">{formatFileSize(file.size)}</small>}
          </div>
          <button
            type="button"
            className="attachment-action"
            aria-label={`پیش‌نمایش ${file.filename}`}
            onClick={() => setOpen(true)}
          >
            <Eye size={17} />
          </button>
          <DownloadButton file={file} />
        </div>
      </div>
      <Modal
        wide
        open={open}
        onOpenChange={setOpen}
        title="پیش‌نمایش فایل"
        description={file.filename}
      >
        <div className="attachment-preview-body">
          {image ? (
            <Image
              src={url}
              unoptimized
              alt={file.filename}
              width={850}
              height={650}
              style={{ width: '100%', height: 'auto', objectFit: 'contain', maxHeight: '65vh' }}
            />
          ) : (
            <DocumentPreview file={file} url={url} />
          )}
        </div>
        <div className="preview-footer">
          <DownloadButton file={file} full />
        </div>
      </Modal>
    </>
  );
}
