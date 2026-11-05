'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';

export function AuthForm({ mode = 'login' }: { mode?: 'login' | 'forgot' | 'reset' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') ?? '').trim();
    const password = String(values.get('password') ?? '');
    try {
      const route =
        mode === 'login'
          ? email.includes('@')
            ? 'sign-in/email'
            : 'sign-in/username'
          : mode === 'forgot'
            ? 'request-password-reset'
            : 'reset-password';
      const body =
        mode === 'login'
          ? {
              ...(email.includes('@') ? { email: email.toLowerCase() } : { username: email }),
              password,
              rememberMe: false,
            }
          : mode === 'forgot'
            ? { email, redirectTo: `${window.location.origin}/reset-password` }
            : { newPassword: password, token: params.get('token') };
      const response = await fetch(`/api/auth/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(
          mode === 'login'
            ? response.status === 403
              ? 'ابتدا ایمیل دانشجویی خود را تأیید کنید.'
              : 'اطلاعات ورود معتبر نیست یا ورود موقتاً محدود شده است.'
            : mode === 'reset'
              ? 'پیوند بازیابی معتبر نیست یا منقضی شده است.'
              : 'ارسال درخواست انجام نشد. کمی بعد تلاش کنید.',
        );
      if (mode === 'login') {
        router.push('/');
        router.refresh();
      } else
        setSuccess(
          mode === 'forgot'
            ? 'اگر حساب فعالی با این ایمیل وجود داشته باشد، راهنمای بازیابی برای آن ارسال می‌شود.'
            : 'رمز عبور تغییر کرد. اکنون می‌توانید وارد شوید.',
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ارتباط با سامانه برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <span className="auth-eyebrow">دانشگاه صنعتی نوشیروانی بابل</span>
      <h2>
        {mode === 'login'
          ? 'به نیتیکت خوش آمدید'
          : mode === 'forgot'
            ? 'بازیابی رمز عبور'
            : 'انتخاب رمز عبور جدید'}
      </h2>
      <p>
        {mode === 'login'
          ? 'برای ثبت و پیگیری درخواست‌ها وارد حساب خود شوید.'
          : mode === 'forgot'
            ? 'نشانی ایمیل حساب دانشگاهی خود را وارد کنید.'
            : 'یک رمز عبور قوی با حداقل ۱۲ نویسه انتخاب کنید.'}
      </p>
      {mode !== 'reset' && (
        <div className="field">
          <label htmlFor="email">
            {mode === 'login' ? 'ایمیل، شماره دانشجویی یا نام کاربری' : 'ایمیل دانشجویی'}
          </label>
          <input
            id="email"
            name="email"
            type={mode === 'login' ? 'text' : 'email'}
            dir="ltr"
            autoComplete="username"
            required
            maxLength={254}
            placeholder={mode === 'login' ? 'ایمیل یا شناسه ورود شما' : 'name@stu.nit.ac.ir'}
          />
        </div>
      )}
      {mode !== 'forgot' && (
        <div className="field">
          <label htmlFor="password">رمز عبور</label>
          <div style={{ position: 'relative' }}>
            <input
              id="password"
              name="password"
              type={visible ? 'text' : 'password'}
              dir="ltr"
              autoComplete={mode === 'reset' ? 'new-password' : 'current-password'}
              minLength={mode === 'reset' ? 12 : 1}
              maxLength={128}
              required
              style={{ paddingInlineEnd: 45 }}
            />
            <button
              type="button"
              aria-label={visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
              onClick={() => setVisible(!visible)}
              style={{
                position: 'absolute',
                left: 10,
                top: 12,
                background: 'none',
                border: 0,
                color: '#8b9b80',
              }}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
      )}
      {mode === 'login' && (
        <div className="auth-links">
          <span>ورود امن با حساب کاربری</span>
          <Link href="/forgot-password">رمز عبور را فراموش کرده‌اید؟</Link>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {mode === 'login' && params.get('verified') === '1' && (
        <p className="success-message" role="status">
          ایمیل شما تأیید شد. اکنون وارد شوید.
        </p>
      )}
      {success && (
        <p role="status" className="success-message">
          {success}
        </p>
      )}
      <Button disabled={busy}>
        {busy
          ? 'لطفاً صبر کنید…'
          : mode === 'login'
            ? 'ورود به حساب'
            : mode === 'forgot'
              ? 'ارسال پیوند بازیابی'
              : 'ذخیره رمز عبور'}
        <ArrowLeft size={17} />
      </Button>
      {mode !== 'login' && (
        <div className="auth-links">
          <Link href="/login">بازگشت به ورود</Link>
        </div>
      )}
      <div className="auth-links">
        <span>هنوز حساب دانشجویی ندارید؟</span>
        <Link href="/register">ثبت‌نام دانشجو</Link>
      </div>
      <p className="auth-footnote">حساب مسئول واحد فقط توسط مدیر سامانه ایجاد می‌شود.</p>
    </form>
  );
}
