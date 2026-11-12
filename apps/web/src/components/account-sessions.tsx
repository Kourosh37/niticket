'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Monitor, Smartphone, Tablet, RefreshCw } from 'lucide-react';
import type { listSessions } from '@niticket/core/application/sessions';
import { request, dateTime } from '@/lib/utils';
import { Button } from './ui/button';

type Data = Awaited<ReturnType<typeof listSessions>>;
type Session = Data['current'];

function Device({
  session,
  current,
  busy,
  revoke,
}: {
  session: Session;
  current?: boolean;
  busy: boolean;
  revoke: () => void;
}) {
  const Icon =
    session.device.kind === 'phone'
      ? Smartphone
      : session.device.kind === 'tablet'
        ? Tablet
        : Monitor;
  return (
    <article className="account-session" data-session-id={session.id}>
      <Icon size={26} aria-hidden="true" />
      <div className="account-session-details">
        <strong>
          <bdi>{session.device.browser}</bdi> · <bdi>{session.device.os}</bdi>
        </strong>
        <span className={current ? 'session-current-tag' : 'session-active-tag'}>
          {current ? 'این دستگاه' : 'نشست فعال'}
        </span>
        <dl>
          <div>
            <dt>زمان ورود</dt>
            <dd>{dateTime(session.loginAt)}</dd>
          </div>
          <div>
            <dt>آخرین فعالیت</dt>
            <dd>{dateTime(session.lastSeenAt)}</dd>
          </div>
        </dl>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={revoke}>
        {current ? 'خروج از این دستگاه' : 'خروج از دستگاه'}
      </Button>
    </article>
  );
}

export function AccountSessions() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null),
    [cursor, setCursor] = useState<string | undefined>(),
    [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void request<Data>(`/api/v1/users/me/sessions${cursor ? `?cursor=${cursor}` : ''}`, {
      signal: abort.signal,
    })
      .then((result) => {
        if (!abort.signal.aborted) {
          setData(result);
          setError('');
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setError(error instanceof Error ? error.message : 'دریافت نشست‌ها انجام نشد.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [cursor, revision]);

  function refresh() {
    setLoading(true);
    setPrevious([]);
    setCursor(undefined);
    setRevision((value) => value + 1);
  }

  async function revoke(id?: string) {
    if (
      busy ||
      !window.confirm(
        id
          ? 'این دستگاه برای ورود دوباره به کد موبایل یا رمز نیاز خواهد داشت. خارج شود؟'
          : 'از همه دستگاه‌های دیگر خارج شوید؟',
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (id === data?.current.id) {
        const response = await fetch('/api/auth/sign-out', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) throw new Error('خروج انجام نشد. دوباره تلاش کنید.');
        router.replace('/login');
        router.refresh();
        return;
      }
      const result = await request<{ revoked: number }>(
        `/api/v1/users/me/sessions${id ? `/${id}` : ''}`,
        {
          method: 'DELETE',
        },
      );
      setSuccess(result.revoked ? 'دسترسی دستگاه‌های انتخاب‌شده لغو شد.' : 'نشست دیگری فعال نیست.');
      setPrevious([]);
      setCursor(undefined);
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'خروج انجام نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="surface account-sessions"
      aria-labelledby="sessions-title"
      aria-busy={loading}
    >
      <div className="sessions-heading">
        <div>
          <h2 id="sessions-title">نشست‌های فعال</h2>
          <p>دستگاه‌هایی که به حساب شما دسترسی دارند.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="به‌روزرسانی نشست‌ها"
          disabled={loading || busy}
          onClick={refresh}
        >
          <RefreshCw size={18} />
        </Button>
      </div>
      {loading && <p role="status">در حال دریافت نشست‌ها…</p>}
      {data && (
        <>
          <Device
            session={data.current}
            current
            busy={busy || loading}
            revoke={() => void revoke(data.current.id)}
          />
          <h3 className="other-sessions-title">دستگاه‌های دیگر</h3>
          {data.items.map((session) => (
            <Device
              key={session.id}
              session={session}
              busy={busy || loading}
              revoke={() => void revoke(session.id)}
            />
          ))}
          {!data.items.length && !loading && (
            <p className="field-hint">دستگاه دیگری در این صفحه فعال نیست.</p>
          )}
          {(previous.length > 0 || data.nextCursor) && (
            <nav className="pagination" aria-label="صفحه‌بندی نشست‌ها">
              {!!previous.length && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || busy}
                  onClick={() => {
                    setLoading(true);
                    setCursor(previous.at(-1));
                    setPrevious((value) => value.slice(0, -1));
                  }}
                >
                  صفحه قبل
                </Button>
              )}
              {data.nextCursor && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || busy}
                  onClick={() => {
                    setLoading(true);
                    setPrevious((value) => [...value, cursor]);
                    setCursor(data.nextCursor!);
                  }}
                >
                  صفحه بعد
                </Button>
              )}
            </nav>
          )}
          {!!data.items.length && (
            <Button
              type="button"
              variant="outline"
              disabled={loading || busy}
              onClick={() => void revoke()}
            >
              خروج از همه دستگاه‌های دیگر
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="success-message">
          {success}
        </p>
      )}
    </section>
  );
}
