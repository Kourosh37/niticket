import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const digits = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

export const date = (value: string | Date) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(
    new Date(value),
  );

export const dateTime = (value: string | Date) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));

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
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
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
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new RequestError('', 'UNAUTHENTICATED', 401);
  }
}
