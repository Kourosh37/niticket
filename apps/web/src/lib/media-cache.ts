import { ClientCache, clientCache, onPrivateCacheReset } from './client-cache';
import { request } from './utils';

const blobs = new ClientCache(
  { entries: 12, bytes: 24 * 1024 * 1024 },
  (value) => (value as Blob).size,
);
const sources = new Map<string, string>();

export const parsedDocuments = new ClientCache({ entries: 12, bytes: 4 * 1024 * 1024 });

export function clearMediaCache() {
  blobs.clear();
  parsedDocuments.clear();
  sources.clear();
}

onPrivateCacheReset(clearMediaCache);

function activate() {
  if (!clientCache.scope) return false;
  blobs.activate(clientCache.scope);
  parsedDocuments.activate(clientCache.scope);
  return true;
}

export function mediaVersion(url: string) {
  return sources.get(url);
}

export async function authorizedMediaVersion(url: string, signal: AbortSignal) {
  const id = url.match(/^\/api\/v1\/attachments\/([^/]+)\/access$/)?.[1];
  if (!id || !activate()) return null;
  const metadata = await request<{ version: string; size: number }>(
    `/api/v1/attachments/${id}/metadata`,
    { signal, cache: 'no-store' },
  );
  return metadata;
}

export function rememberMedia(url: string, version: string | null, blob: Blob) {
  if (!version || blob.size > 20 * 1024 * 1024 || !activate()) return;
  blobs.remember(`${url}:${version}`, blob, ['media'], 300000);
  sources.delete(url);
  sources.set(url, version);
  while (sources.size > 24) sources.delete(sources.keys().next().value!);
}

export async function reuseMedia(url: string, signal: AbortSignal) {
  if (!sources.has(url)) return null;
  const metadata = await authorizedMediaVersion(url, signal);
  signal.throwIfAborted();
  return metadata ? (blobs.peek<Blob>(`${url}:${metadata.version}`) ?? null) : null;
}

export async function mediaBlob(
  url: string,
  signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<Blob>,
) {
  const metadata = await authorizedMediaVersion(url, signal);
  if (!metadata) return load(signal);
  if (metadata.size > 20 * 1024 * 1024)
    throw new Error('این فایل برای پیش‌نمایش بزرگ است؛ آن را دریافت کنید.');
  const blob = await blobs.load(`${url}:${metadata.version}`, ['media'], 300000, load, signal);
  sources.delete(url);
  sources.set(url, metadata.version);
  while (sources.size > 24) sources.delete(sources.keys().next().value!);
  return blob;
}
