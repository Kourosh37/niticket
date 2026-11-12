import type { OfficePreview } from '../workers/office-preview';
import { clientCache } from './client-cache';
import { parsedDocuments } from './media-cache';

export function previewOffice(
  data: ArrayBuffer,
  mime: string,
  signal: AbortSignal,
  key?: string,
): Promise<OfficePreview> {
  if (key && clientCache.scope) {
    parsedDocuments.activate(clientCache.scope);
    return parsedDocuments.load(
      `${key}:${mime}:office-v1`,
      ['media'],
      300000,
      (sharedSignal) => parseOffice(data, mime, sharedSignal),
      signal,
    );
  }
  return parseOffice(data, mime, signal);
}

function parseOffice(data: ArrayBuffer, mime: string, signal: AbortSignal): Promise<OfficePreview> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('../workers/office-preview.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (result?: OfficePreview, error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(
      () => finish(undefined, new Error('پیش‌نمایش زمان‌بر شد؛ فایل را دریافت کنید.')),
      15000,
    );
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () =>
      finish(undefined, new Error('پیش‌نمایش فایل انجام نشد. فایل را دریافت کنید.'));
    worker.onmessage = (event: MessageEvent<{ result?: OfficePreview; error?: string }>) =>
      finish(event.data.result, event.data.error ? new Error(event.data.error) : undefined);
    worker.postMessage({ data, mime }, [data]);
  });
}
