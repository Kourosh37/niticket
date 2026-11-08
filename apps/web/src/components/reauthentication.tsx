'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { asciiDigits } from '@niticket/core/domain/phone';
import { Button } from './ui/button';
import { request, RequestError } from '@/lib/utils';

function PasswordConfirmation({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [method, setMethod] = useState<'code' | 'password'>('code');
  const [value, setValue] = useState(''),
    [sent, setSent] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0),
    [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ resendAfter: number }>('/api/v1/reauthenticate/code', {
        method: 'POST',
        body: '{}',
      });
      setResendAt(Date.now() + result.resendAfter * 1000);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ارسال انجام نشد.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || !value) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/v1/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({ [method]: value }),
      });
      setValue('');
      onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تأیید انجام نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="reauthentication-inline" aria-label="تأیید هویت برای ادامه عملیات">
      <legend>تأیید هویت برای ادامه</legend>
      <p>با کد موبایل یا رمز حساب، همین عملیات را تأیید کنید.</p>
      {method === 'code' && (
        <Button
          type="button"
          variant="outline"
          disabled={busy || remaining > 0}
          onClick={() => void send()}
        >
          {remaining > 0
            ? `ارسال دوباره (${remaining})`
            : sent
              ? 'ارسال دوباره کد'
              : 'دریافت کد تأیید'}
        </Button>
      )}
      {(method === 'password' || sent) && (
        <>
          <label htmlFor={id}>
            {method === 'code' ? 'کد ۶ رقمی تأیید' : 'رمز عبور فعلی برای تأیید'}
          </label>
          <input
            id={id}
            type={method === 'password' ? 'password' : 'text'}
            inputMode={method === 'code' ? 'numeric' : undefined}
            value={value}
            onChange={(e) =>
              setValue(
                method === 'code'
                  ? asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 6)
                  : e.target.value,
              )
            }
            autoComplete={method === 'code' ? 'one-time-code' : 'current-password'}
            dir="ltr"
            enterKeyHint="done"
            maxLength={method === 'code' ? 6 : 128}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void verify();
              }
            }}
          />
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button type="button" disabled={busy || !value} onClick={() => void verify()}>
          {busy ? 'در حال تأیید…' : 'تأیید و ادامه عملیات'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setMethod(method === 'code' ? 'password' : 'code');
            setValue('');
            setError('');
          }}
        >
          {method === 'code' ? 'تأیید با رمز' : 'تأیید با کد موبایل'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </fieldset>
  );
}

export function useReauthentication() {
  const [required, setRequired] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const running = useRef(false);
  useEffect(
    () => () => {
      pending.current?.reject(new Error(''));
      pending.current = null;
    },
    [],
  );

  async function run<T>(action: () => Promise<T>): Promise<T> {
    if (running.current) throw new Error('');
    running.current = true;
    try {
      for (;;) {
        try {
          return await action();
        } catch (error) {
          if (!(error instanceof RequestError) || error.code !== 'REAUTH_REQUIRED') throw error;
          await new Promise<void>((resolve, reject) => {
            pending.current = { resolve, reject };
            setRequired(true);
          });
        }
      }
    } finally {
      running.current = false;
    }
  }

  function finish(verified: boolean) {
    const current = pending.current;
    pending.current = null;
    setRequired(false);
    if (verified) current?.resolve();
    else current?.reject(new Error(''));
  }

  return {
    run,
    confirmation: required ? (
      <PasswordConfirmation onVerified={() => finish(true)} onCancel={() => finish(false)} />
    ) : null,
  };
}
