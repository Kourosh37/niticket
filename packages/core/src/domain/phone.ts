import { z } from 'zod';

export const asciiDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));

export function normalizeIranianPhone(value: string) {
  let phone = asciiDigits(value.trim()).replace(/[\s()-]/g, '');
  if (phone.startsWith('0098')) phone = `+98${phone.slice(4)}`;
  else if (/^989\d{9}$/.test(phone)) phone = `+${phone}`;
  else if (/^09\d{9}$/.test(phone)) phone = `+98${phone.slice(1)}`;
  else if (/^9\d{9}$/.test(phone)) phone = `+98${phone}`;
  return phone;
}

export const iranianPhoneSchema = z
  .string()
  .max(40)
  .transform(normalizeIranianPhone)
  .pipe(z.string().regex(/^\+989\d{9}$/, 'شماره موبایل ایرانی معتبر وارد کنید.'));

export const otpCodeSchema = z
  .string()
  .max(12)
  .transform((value) => asciiDigits(value.trim()))
  .pipe(z.string().regex(/^\d{6}$/, 'کد ۶ رقمی را وارد کنید.'));

export const passwordSchema = z.string().min(12, 'رمز عبور حداقل ۱۲ نویسه باشد.').max(128);

export const displayPhone = (phone: string) =>
  phone.startsWith('+98') ? `0${phone.slice(3)}` : phone;
