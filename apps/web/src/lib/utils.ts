import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { clientCache, queryPolicy } from './client-cache';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFormat = new Intl.NumberFormat('fa-IR');
const dateFormat = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeZone: 'Asia/Tehran',
});
const dateTimeFormat = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tehran',
});

export const digits = (n: number) => numberFormat.format(n);

export const date = (value: string | Date) => dateFormat.format(new Date(value));

export const dateTime = (value: string | Date) => dateTimeFormat.format(new Date(value));

export const statusNames: Record<string, string> = {
  OPEN: 'باز',
  IN_PROGRESS: 'در حال بررسی',
  WAITING_FOR_USER: 'در انتظار پاسخ شما',
  WAITING_FOR_DEPARTMENT: 'در انتظار واحد',
  RESOLVED: 'حل‌شده',
  CLOSED: 'بسته‌شده',
  REOPENED: 'بازگشایی‌شده',
};

export const priorityNames: Record<string, string> = {
  LOW: 'کم',
  NORMAL: 'عادی',
  HIGH: 'زیاد',
  URGENT: 'فوری',
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const policy = method === 'GET' ? queryPolicy(path) : undefined;
  if (policy && options.cache !== 'no-store')
    return clientCache.load(
      policy.key,
      policy.tags,
      policy.ttl,
      (signal) => fetchRequest<T>(path, { ...options, signal }),
      options.signal ?? undefined,
    );
  const data = await fetchRequest<T>(path, options);
  if (!['GET', 'HEAD'].includes(method)) clientCache.mutated(path);
  return data;
}

async function fetchRequest<T>(path: string, options: RequestInit): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (clientCache.freshUntil > Date.now()) headers.set('cache-control', 'no-cache');
  const response = await fetch(path, {
    ...options,
    headers,
  });
  checkSession(response);
  const result = await response.json();
  if (!response.ok)
    throw new RequestError(
      result.error?.message ?? 'عملیات انجام نشد. دوباره تلاش کنید.',
      result.error?.code,
      response.status,
    );
  return result.data as T;
}

export class RequestError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function checkSession(response: Response) {
  if (response.status === 401) {
    clientCache.clear();
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new RequestError('', 'UNAUTHENTICATED', 401);
  }
}
