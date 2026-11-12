import { checkSession } from './utils';
import { mediaBlob } from './media-cache';

export const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

export async function previewBytes(url: string, signal: AbortSignal) {
  const blob = await mediaBlob(url, signal, async (sharedSignal) => {
    const data = await readBytes(url, sharedSignal);
    return new Blob([data.buffer], { type: data.mime });
  });
  signal.throwIfAborted();
  return blob.arrayBuffer();
}

async function readBytes(url: string, signal: AbortSignal) {
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
  try {
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
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    buffer: bytes.buffer,
    mime: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}
