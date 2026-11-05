'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from './ui/button';
import { request } from '@/lib/utils';

export function RegisterForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  return (
    <form
      className="auth-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setError('');
        setBusy(true);
        try {
          if (f.get('password') !== f.get('confirm')) throw new Error('تکرار رمز عبور یکسان نیست.');
          const result = await request<{ message: string }>('/api/register', {
            method: 'POST',
            body: JSON.stringify({
              name: f.get('name'),
              email: f.get('email'),
              studentNumber: f.get('studentNumber'),
              password: f.get('password'),
            }),
          });
          setMessage(result.message);
          form.reset();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'ثبت‌نام انجام نشد.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="auth-eyebrow">دانشگاه صنعتی نوشیروانی بابل</span>
      <h2>ثبت‌نام دانشجو</h2>
      <p>با ایمیل دانشجویی خود حساب بسازید؛ پس از تأیید ایمیل وارد شوید.</p>
      <div className="field">
        <label htmlFor="register-name">نام و نام خانوادگی</label>
        <input
          id="register-name"
          name="name"
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
        />
      </div>
      <div className="field">
        <label htmlFor="studentNumber">شماره دانشجویی</label>
        <input
          id="studentNumber"
          name="studentNumber"
          inputMode="numeric"
          dir="ltr"
          required
          minLength={7}
          maxLength={14}
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label htmlFor="register-email">ایمیل دانشجویی</label>
        <input
          id="register-email"
          name="email"
          type="email"
          dir="ltr"
          placeholder="name@stu.nit.ac.ir"
          required
          autoComplete="email"
          maxLength={254}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="register-password">رمز عبور</label>
          <input
            id="register-password"
            name="password"
            type="password"
            dir="ltr"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label htmlFor="register-confirm">تکرار رمز عبور</label>
          <input
            id="register-confirm"
            name="confirm"
            type="password"
            dir="ltr"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </div>
      </div>
      <p className="field-hint">
        رمز عبور حداقل ۱۲ نویسه باشد. پیوند تأیید به ایمیل دانشجویی ارسال می‌شود.
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      <Button disabled={busy}>{busy ? 'در حال ثبت‌نام…' : 'ثبت‌نام و ارسال پیوند تأیید'}</Button>
      <div className="auth-links">
        <span>حساب دارید؟</span>
        <Link href="/login">ورود به سامانه</Link>
      </div>
    </form>
  );
}
