'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './ui/button';
import { request, RequestError } from '@/lib/utils';

function PasswordConfirmation({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy]);

  async function verify() {
    if (busy || !password) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/v1/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setPassword('');
      onVerified();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تأیید رمز انجام نشد.');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="reauthentication-inline" aria-label="تأیید رمز برای ادامه عملیات">
      <legend>تأیید رمز برای ادامه</legend>
      <p>برای انجام همین عملیات، رمز عبور حساب خود را وارد کنید.</p>
      <label htmlFor={id}>رمز عبور فعلی برای تأیید</label>
      <input
        ref={input}
        id={id}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        dir="ltr"
        maxLength={128}
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            void verify();
          }
        }}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button type="button" disabled={busy || !password} onClick={() => void verify()}>
          {busy ? 'در حال تأیید…' : 'تأیید و ادامه عملیات'}
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
