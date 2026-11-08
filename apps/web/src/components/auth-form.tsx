'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { iranianPhoneSchema, asciiDigits, displayPhone } from '@niticket/core/domain/phone';
import { Button } from './ui/button';

export function AuthForm() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [mode, setMode] = useState<'phone' | 'code' | 'password'>('phone');
  const [code, setCode] = useState(''),
    [password, setPassword] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0),
    [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  useEffect(() => {
    if (mode === 'code' && !busy) document.getElementById('otp-code')?.focus();
  }, [mode, busy]);

  async function send(path: string, body: object) {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'تعداد تلاش‌ها زیاد است. کمی بعد دوباره تلاش کنید.'
          : response.status === 503
            ? 'سرویس ورود موقتاً در دسترس نیست.'
            : path.includes('verify')
              ? 'کد معتبر نیست یا منقضی شده است.'
              : path.includes('sign-in')
                ? 'شماره موبایل یا رمز عبور معتبر نیست.'
                : 'شماره موبایل را بررسی کنید.',
      );
    return result;
  }

  function validatedPhone() {
    const result = iranianPhoneSchema.safeParse(phoneNumber);
    if (!result.success) throw new Error('شماره موبایل ایرانی معتبر وارد کنید.');
    return result.data;
  }

  async function sendCode() {
    const phone = validatedPhone();
    const result = await send('phone-number/send-otp', { phoneNumber: phone });
    setResendAt(Date.now() + result.resendAfter * 1000);
    setPhoneNumber(displayPhone(phone));
    setCode('');
    setMode('code');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'phone') await sendCode();
      else {
        await send(
          mode === 'code' ? 'phone-number/verify' : 'sign-in/phone-number',
          mode === 'code'
            ? { phoneNumber: validatedPhone(), code }
            : { phoneNumber: validatedPhone(), password },
        );
        router.replace('/');
        router.refresh();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'ارتباط برقرار نشد. دوباره تلاش کنید.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <span className="auth-eyebrow">دانشگاه صنعتی نوشیروانی بابل</span>
      <h2>{mode === 'code' ? 'کد ورود را وارد کنید' : 'به نیتیکت خوش آمدید'}</h2>
      <p>
        {mode === 'code' ? (
          <>
            کد یک‌بارمصرف برای <bdi>{phoneNumber}</bdi>
          </>
        ) : (
          'فقط با شماره موبایل وارد شوید؛ حساب شما خودکار ساخته می‌شود.'
        )}
      </p>
      <fieldset className="form-fields" disabled={busy}>
        {mode !== 'code' && (
          <div className="field">
            <label htmlFor="phone-number">شماره موبایل</label>
            <input
              id="phone-number"
              name="phoneNumber"
              type="tel"
              inputMode="numeric"
              enterKeyHint="next"
              dir="ltr"
              autoComplete="tel"
              placeholder="09123456789"
              maxLength={40}
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              required
            />
          </div>
        )}
        {mode === 'code' && (
          <div className="field">
            <label htmlFor="otp-code">کد ۶ رقمی</label>
            <input
              key="code"
              id="otp-code"
              name="code"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="one-time-code"
              autoFocus
              minLength={6}
              maxLength={12}
              enterKeyHint="done"
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 6))}
              required
            />
          </div>
        )}
        {mode === 'password' && (
          <div className="field">
            <label htmlFor="password">رمز عبور</label>
            <input
              id="password"
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <Button disabled={busy}>
          {busy ? 'لطفاً صبر کنید…' : mode === 'phone' ? 'دریافت کد ورود' : 'ورود'}
          <ArrowLeft size={17} />
        </Button>
        <div className="auth-links">
          {mode === 'code' ? (
            <>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setMode('phone');
                  setError('');
                }}
              >
                تغییر شماره
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={busy || remaining > 0}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await sendCode();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'ارسال انجام نشد.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {remaining > 0 ? `ارسال دوباره (${remaining})` : 'ارسال دوباره کد'}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setMode(mode === 'password' ? 'phone' : 'password');
                setPassword('');
                setError('');
              }}
            >
              {mode === 'password' ? 'ورود با کد یک‌بارمصرف' : 'ورود با رمز'}
            </Button>
          )}
        </div>
      </fieldset>
      {mode === 'password' && (
        <p className="auth-footnote">رمز ندارید یا فراموش کرده‌اید؟ با کد یک‌بارمصرف وارد شوید.</p>
      )}
    </form>
  );
}
