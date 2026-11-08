import { checkSession } from './utils';

export type DownloadFile = { id: string; filename: string; size?: number | null };

export type DownloadState = DownloadFile & {
  status: 'queued' | 'downloading' | 'complete' | 'cancelled' | 'error';
  received: number;
  total: number | null;
  error?: string;
};

type Job = { file: DownloadFile; controller: AbortController };
const MAX_BYTES = 50 * 1024 * 1024,
  MAX_ACTIVE = 2,
  MAX_PENDING = 8;
const states = new Map<string, DownloadState>(),
  jobs = new Map<string, Job>();
const listeners = new Set<() => void>(),
  urls = new Map<string, ReturnType<typeof setTimeout>>();
const EMPTY: readonly DownloadState[] = [];
let snapshot: readonly DownloadState[] = EMPTY,
  queue: Job[] = [],
  running = 0;
const decimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

export const subscribeDownloads = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getDownloads = () => snapshot;

export const getEmptyDownloads = () => EMPTY;

export const downloadFor = (id: string) => states.get(id) ?? null;

export const downloadPercent = (state: DownloadState) =>
  state.status === 'complete'
    ? 100
    : state.total
      ? Math.min(99, Math.floor((state.received / state.total) * 100))
      : null;

export function downloadSize(state: DownloadState) {
  const size = state.total || state.received;
  const [unit, divisor] =
    size >= 1024 ** 3
      ? (['GB', 1024 ** 3] as const)
      : size >= 1024 ** 2
        ? (['MB', 1024 ** 2] as const)
        : size >= 1024
          ? (['KB', 1024] as const)
          : (['B', 1] as const);
  const format = (bytes: number) =>
    `${divisor === 1 ? Math.floor(bytes) : decimal.format(bytes / divisor)} ${unit}`;
  return state.total
    ? `${format(state.received)} / ${format(state.total)}`
    : format(state.received);
}

function publish() {
  const inactive = [...states.values()].filter((state) => !jobs.has(state.id));
  for (const state of inactive.slice(0, Math.max(0, inactive.length - 8))) states.delete(state.id);
  snapshot = states.size ? [...states.values()] : EMPTY;
  for (const listener of listeners) listener();
}

function update(job: Job, patch: Partial<DownloadState>) {
  if (jobs.get(job.file.id) !== job) return;
  states.set(job.file.id, { ...states.get(job.file.id)!, ...patch });
  publish();
}

function save(parts: BlobPart[], filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob(parts, { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[\\/]/g, '_');
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  urls.set(
    url,
    setTimeout(() => {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }, 1000),
  );
}

async function perform(job: Job) {
  running++;
  update(job, { status: 'downloading' });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`/api/v1/attachments/${job.file.id}/access`, {
      signal: job.controller.signal,
      cache: 'no-store',
    });
    checkSession(response);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('فایل در دسترس نیست یا اجازه دریافت آن را ندارید.');
    }
    const encoding = response.headers.get('content-encoding');
    const declared =
      !encoding || encoding === 'identity' ? Number(response.headers.get('content-length')) : 0;
    if (declared > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('حجم فایل بیش از حد مجاز است.');
    }
    const total =
      declared > 0 ? declared : job.file.size && job.file.size > 0 ? job.file.size : null;
    update(job, { total });
    reader = response.body?.getReader();
    if (!reader) throw new Error('دریافت فایل در این مرورگر انجام نشد.');
    const parts: BlobPart[] = [];
    let received = 0,
      lastUpdate = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_BYTES || (declared > 0 && received > declared))
        throw new Error('حجم فایل معتبر نیست.');
      parts.push(chunk.value as Uint8Array<ArrayBuffer>);
      const now = performance.now();
      if (now - lastUpdate >= 100) {
        lastUpdate = now;
        update(job, { received });
      }
    }
    if (!received || (declared > 0 && received !== declared))
      throw new Error('دریافت فایل کامل نشد. دوباره تلاش کنید.');
    if (jobs.get(job.file.id) !== job || job.controller.signal.aborted) return;
    save(
      parts,
      job.file.filename,
      response.headers.get('content-type') ?? 'application/octet-stream',
    );
    update(job, { status: 'complete', received, total: received });
  } catch (error) {
    update(job, {
      status: job.controller.signal.aborted ? 'cancelled' : 'error',
      error: job.controller.signal.aborted
        ? undefined
        : error instanceof Error
          ? error.message
          : 'دریافت انجام نشد. دوباره تلاش کنید.',
    });
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    if (jobs.get(job.file.id) === job) jobs.delete(job.file.id);
    running--;
    pump();
  }
}

function pump() {
  while (running < MAX_ACTIVE && queue.length) {
    const job = queue.shift()!;
    if (jobs.get(job.file.id) === job) void perform(job);
  }
}

export function startDownload(input: DownloadFile) {
  const file: DownloadFile = { id: input.id, filename: input.filename, size: input.size };
  if (jobs.has(file.id)) return;
  if (jobs.size >= MAX_PENDING) {
    states.set(file.id, {
      ...file,
      status: 'error',
      received: 0,
      total: file.size ?? null,
      error: 'ابتدا منتظر دریافت فایل‌های قبلی بمانید.',
    });
    publish();
    return;
  }
  const job = { file, controller: new AbortController() };
  jobs.set(file.id, job);
  states.set(file.id, { ...file, status: 'queued', received: 0, total: file.size ?? null });
  queue.push(job);
  publish();
  pump();
}

export function cancelDownload(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  job.controller.abort();
  const state = states.get(id);
  if (state) states.set(id, { ...state, status: 'cancelled', error: undefined });
  publish();
  pump();
}

export function dismissDownload(id: string) {
  if (!jobs.has(id)) {
    states.delete(id);
    publish();
  }
}

export function clearDownloads() {
  for (const job of jobs.values()) job.controller.abort();
  jobs.clear();
  queue = [];
  states.clear();
  for (const [url, timer] of urls) {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
  urls.clear();
  publish();
}
