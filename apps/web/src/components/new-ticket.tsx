'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Building2, ChevronLeft, LoaderCircle, Search } from 'lucide-react';
import { Button } from './ui/button';
import { request } from '@/lib/utils';

type Choices = Awaited<
  ReturnType<typeof import('@niticket/core/application/administration').conversationChoices>
>;

export function NewTicket({
  initial,
  initialDepartment,
}: {
  initial: Choices;
  initialDepartment?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [cursor, setCursor] = useState<string | undefined>(),
    [previous, setPrevious] = useState<(string | undefined)[]>([]),
    [loading, setLoading] = useState(false);
  const first = useRef(true);
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState(''),
    [openingId, setOpeningId] = useState<string | null>(null),
    [error, setError] = useState('');
  const opening = useRef(false);
  const open = useCallback(
    async (departmentId: string) => {
      if (opening.current) return;
      opening.current = true;
      setOpeningId(departmentId);
      setError('');
      try {
        const { id } = await request<{ id: string }>('/api/v1/conversations', {
          method: 'POST',
          body: JSON.stringify({ departmentId }),
        });
        router.replace(`/tickets/${id}`);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'گفتگو باز نشد. دوباره تلاش کنید.');
        setOpeningId(null);
        opening.current = false;
      }
    },
    [router],
  );
  useEffect(() => {
    if (!initialDepartment) return;
    const pending = setTimeout(() => void open(initialDepartment), 0);
    return () => clearTimeout(pending);
  }, [initialDepartment, open]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (composing) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ q: search.trim(), ...(cursor ? { cursor } : {}) });
      void request<Choices>(`/api/v1/departments/choices?${query}`, { signal: abort.signal })
        .then((result) => {
          if (!abort.signal.aborted) {
            setData(result);
            setError('');
          }
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setError(error instanceof Error ? error.message : 'دریافت واحدها انجام نشد.');
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, cursor, composing]);
  return (
    <div className="easy-new-ticket messenger-picker">
      <Link href="/" className="easy-back">
        <ArrowRight size={20} />
        گفتگوها
      </Link>
      <div className="new-ticket-heading">
        <h1>به کدام واحد پیام می‌دهید؟</h1>
        <p>واحد را انتخاب کنید و همان‌جا پیام بفرستید.</p>
      </div>
      <section className="new-ticket-card" aria-label="واحدهای دانشگاه">
        {(initial.items.length > 5 || initial.nextCursor) && (
          <div className="unit-search">
            <Search size={20} />
            <input
              type="search"
              enterKeyHint="search"
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              aria-label="جستجوی واحد"
              placeholder="نام واحد را بنویسید…"
              value={search}
              maxLength={100}
              onChange={(event) => {
                setSearch(event.target.value);
                setCursor(undefined);
                setPrevious([]);
                setLoading(true);
              }}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="unit-choices" aria-busy={loading}>
          {data.items.map((d) => (
            <button
              type="button"
              key={d.id}
              className="unit-choice"
              disabled={loading || !!openingId || !(d.acceptingTickets || d.canContinue)}
              aria-label={`انتخاب ${d.name}`}
              onClick={() => void open(d.id)}
            >
              <span className="unit-choice-icon">
                <Building2 size={24} />
              </span>
              <span>
                <strong>{d.name}</strong>
                <small>
                  {openingId === d.id
                    ? 'در حال باز کردن گفتگو…'
                    : d.canContinue
                      ? 'ادامه گفتگوی شما با این واحد'
                      : d.acceptingTickets
                        ? d.description || 'ارسال پیام، وویس یا فایل'
                        : 'در حال حاضر گفتگوی جدید نمی‌پذیرد'}
                </small>
              </span>
              {openingId === d.id ? (
                <LoaderCircle className="messenger-loading" size={21} />
              ) : (
                <ChevronLeft size={21} />
              )}
            </button>
          ))}
        </div>
        {loading && <p role="status">در حال دریافت واحدها…</p>}
        {(data.nextCursor || previous.length > 0) && (
          <nav className="unit-load-more" aria-label="صفحه‌بندی واحدها">
            {!!previous.length && (
              <Button
                type="button"
                variant="outline"
                disabled={loading || !!openingId}
                onClick={() => {
                  setLoading(true);
                  setCursor(previous.at(-1));
                  setPrevious((value) => value.slice(0, -1));
                }}
              >
                واحدهای قبلی
              </Button>
            )}
            {data.nextCursor && (
              <Button
                type="button"
                variant="outline"
                disabled={loading || !!openingId}
                onClick={() => {
                  setLoading(true);
                  setPrevious((value) => [...value, cursor]);
                  setCursor(data.nextCursor!);
                }}
              >
                واحدهای بیشتر
              </Button>
            )}
          </nav>
        )}
        {!data.items.length && !loading && (
          <p className="new-no-units" role="status">
            {search.trim()
              ? 'واحدی با این نام پیدا نشد.'
              : 'هنوز واحدی برای دریافت پیام فعال نشده است.'}
          </p>
        )}
      </section>
    </div>
  );
}
