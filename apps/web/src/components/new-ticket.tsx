'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronLeft, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from './ui/button';
import { request } from '@/lib/utils';
import { clientCache, queryPolicy } from '@/lib/client-cache';
import { useRealtimeSync } from '@/lib/use-realtime-sync';

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
  const [loadError, setLoadError] = useState(''),
    [revision, setRevision] = useState(0);
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
            setLoadError('');
          }
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setLoadError(error instanceof Error ? error.message : 'دریافت واحدها انجام نشد.');
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, cursor, composing, revision]);

  function searchUnits(value: string) {
    const params = new URLSearchParams({ q: value.trim() });
    const policy = queryPolicy(`/api/v1/departments/choices?${params}`);
    const warm = policy ? clientCache.peek<Choices>(policy.key) : undefined;
    if (warm) setData(warm);
    setSearch(value);
    setCursor(undefined);
    setPrevious([]);
    setLoadError('');
    setError('');
    setLoading(!warm);
  }
  useRealtimeSync(
    () => {
      setRevision((value) => value + 1);
    },
    ['catalog', 'inbox'],
    { initial: false, liveMs: 120000, fallbackMs: 30000 },
  );

  return (
    <div className="easy-new-ticket messenger-picker">
      <div className="new-ticket-heading">
        <h1>به کدام واحد پیام می‌دهید؟</h1>
        <p>واحد را انتخاب کنید و همان‌جا پیام بفرستید.</p>
      </div>
      <section className="new-ticket-card" aria-label="واحدهای دانشگاه">
        <div className="unit-search">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            aria-label="جستجوی واحد"
            placeholder="نام واحد را بنویسید…"
            value={search}
            disabled={!!openingId}
            maxLength={100}
            onChange={(event) => {
              searchUnits(event.target.value);
            }}
          />
          {!!search && (
            <button
              type="button"
              className="unit-search-clear"
              aria-label="پاک کردن جستجوی واحد"
              disabled={!!openingId}
              onClick={() => searchUnits('')}
            >
              <X size={18} />
            </button>
          )}
        </div>
        {loadError && (
          <div role="alert" className="error-message">
            <p>{loadError}</p>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setRevision((value) => value + 1);
              }}
            >
              تلاش دوباره
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div
          className="unit-choices"
          role="region"
          aria-label="نتایج جستجوی واحد"
          aria-busy={loading}
        >
          {data.items.map((d) => (
            <button
              type="button"
              key={d.id}
              className="unit-choice"
              disabled={
                loading || !!loadError || !!openingId || !(d.acceptingTickets || d.canContinue)
              }
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
                disabled={loading || !!loadError || !!openingId}
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
                disabled={loading || !!loadError || !!openingId}
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
        {!data.items.length && !loading && !loadError && (
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
