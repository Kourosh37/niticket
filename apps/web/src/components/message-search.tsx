'use client';

import { Select } from './ui/select';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  SlidersHorizontal,
  Paperclip,
  Lock,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  UserRound,
} from 'lucide-react';
import type {
  searchMessages,
  searchSenders,
  MessageSearchFilters,
} from '@niticket/core/application/message-search';
import { normalizeSearchText } from '@niticket/core/domain/search-text';
import { request, dateTime, digits } from '@/lib/utils';
import { searchParameters } from '@/lib/search';
import { Button } from './ui/button';
import { SearchHighlight } from './search-highlight';

export type SearchData = Awaited<ReturnType<typeof searchMessages>>;

export type SearchResult = SearchData['items'][number];

export type SearchFilters = Omit<MessageSearchFilters, 'cursor'>;

export type SearchSelection = {
  filters: SearchFilters;
  data: SearchData;
  index: number;
  cursor?: string;
  previous: (string | undefined)[];
};

export const emptySearch: SearchFilters = {
  q: '',
  kind: 'all',
  mode: 'all',
  sort: 'newest',
  visibility: 'all',
};

const ready = (f: SearchFilters) =>
  normalizeSearchText(f.q).length >= 2 ||
  (!f.q.trim() && !!(f.senderId || f.from || f.to || f.kind !== 'all' || f.visibility !== 'all'));

function SenderPicker({
  ticketId,
  choose,
}: {
  ticketId?: string;
  choose: (id: string, name: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [cursor, setCursor] = useState<string | undefined>(),
    [data, setData] = useState<Awaited<ReturnType<typeof searchSenders>> | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [composing, setComposing] = useState(false);
  useEffect(() => {
    if (composing) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const params = searchParameters({ q: query, ticketId, cursor });
      void request<Awaited<ReturnType<typeof searchSenders>>>(`/api/v1/search/senders?${params}`, {
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
            setError(error instanceof Error ? error.message : 'دریافت فرستنده‌ها انجام نشد.');
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [ticketId, query, cursor, composing]);
  return (
    <div className="search-sender-picker" aria-busy={loading}>
      <input
        type="search"
        enterKeyHint="search"
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        aria-label="پیدا کردن فرستنده"
        placeholder="نام فرستنده…"
        maxLength={100}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(undefined);
          setLoading(true);
        }}
      />
      {loading && <small role="status">در حال دریافت فرستنده‌ها…</small>}
      {error && <p role="alert">{error}</p>}
      <div className="search-sender-options">
        {data?.items.map((person) => (
          <button
            key={person.id}
            type="button"
            disabled={loading}
            onClick={() => choose(person.id, person.name)}
          >
            {person.name}
          </button>
        ))}
      </div>
      {data && !data.items.length && !loading && <small>فرستنده‌ای پیدا نشد.</small>}
      {data?.nextCursor && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => {
            setCursor(data.nextCursor!);
            setLoading(true);
          }}
        >
          فرستنده‌های بیشتر
        </Button>
      )}
      {cursor && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => {
            setCursor(undefined);
            setLoading(true);
          }}
        >
          بازگشت به ابتدا
        </Button>
      )}
    </div>
  );
}

export function MessageSearch({
  actorId,
  privateAllowed,
  initial = {},
  restore,
  onSelect,
  inline = false,
  autoFocus = true,
  syncUrl = true,
  returnPath = '/search',
  onClose,
  children,
}: {
  inline?: boolean;
  autoFocus?: boolean;
  syncUrl?: boolean;
  returnPath?: string;
  onClose?: () => void;
  children?: React.ReactNode;
  actorId: string;
  privateAllowed: boolean;
  initial?: Partial<SearchFilters>;
  restore?: SearchSelection | null;
  onSelect?: (result: SearchResult, selection: SearchSelection) => void;
}) {
  const router = useRouter();
  const pending = useRef<AbortController | null>(null);
  const [composing, setComposing] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({
      ...emptySearch,
      ...initial,
      ...restore?.filters,
    }),
    [cursor, setCursor] = useState<string | undefined>(restore?.cursor),
    [previous, setPrevious] = useState<(string | undefined)[]>(restore?.previous ?? []),
    [data, setData] = useState<SearchData | null>(restore?.data ?? null),
    [loading, setLoading] = useState(ready({ ...emptySearch, ...initial, ...restore?.filters })),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [active, setActive] = useState(restore?.index ?? 0),
    [filtersOpen, setFiltersOpen] = useState(false),
    [senderOpen, setSenderOpen] = useState(false),
    [senderName, setSenderName] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null),
    scrollPage = useRef(false),
    restoreResult = useRef(restore?.data.items[restore.index]?.id);
  useEffect(() => {
    if (autoFocus) searchInput.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const enabled = ready(filters),
    scoped = !!onSelect,
    resultsShown = !children || !!filters.q.trim() || enabled;
  const address = useCallback(
    (value: SearchFilters) => {
      const [path, query] = returnPath.split('?');
      const params = new URLSearchParams(query);
      params.delete('cursor');
      searchParameters(value).forEach((value, key) => params.set(key, value));
      return `${path}?${params}`;
    },
    [returnPath],
  );
  useEffect(() => {
    if (!enabled || composing) return;
    const abort = new AbortController();
    pending.current = abort;
    const timer = setTimeout(() => {
      if (!scoped && syncUrl) window.history.replaceState(null, '', address(filters));
      void request<SearchData>(`/api/v1/search?${searchParameters({ ...filters, cursor })}`, {
        signal: abort.signal,
      })
        .then((result) => {
          if (!abort.signal.aborted) {
            setData(result);
            const restored = restoreResult.current
              ? Math.max(
                  0,
                  result.items.findIndex((item) => item.id === restoreResult.current),
                )
              : 0;
            setActive(restored);
            if (scrollPage.current || restoreResult.current)
              requestAnimationFrame(() => {
                if (abort.signal.aborted) return;
                const region = panel.current?.querySelector('.message-search-results');
                region?.scrollTo({ top: 0 });
                if (restoreResult.current)
                  panel.current
                    ?.querySelector(`[data-search-result="${result.items[restored]?.id}"]`)
                    ?.scrollIntoView({ block: 'nearest' });
                else if (!scoped) panel.current?.scrollIntoView({ block: 'start' });
                scrollPage.current = false;
                restoreResult.current = undefined;
              });
            setError('');
          }
        })
        .catch((error) => {
          if (!abort.signal.aborted) {
            setData(null);
            setError(error instanceof Error ? error.message : 'جستجو انجام نشد.');
          }
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [filters, cursor, enabled, revision, scoped, composing, syncUrl, address]);

  function change(patch: Partial<SearchFilters>) {
    pending.current?.abort();
    const next = { ...filters, ...patch };
    setFilters(next);
    restoreResult.current = undefined;
    setCursor(undefined);
    setPrevious([]);
    setActive(0);
    setLoading(ready(next));
    setError('');
    setData(null);
    if (!ready(next) && !onSelect && syncUrl) window.history.replaceState(null, '', address(next));
  }

  const resultUrl = (result: SearchResult) =>
    `/tickets/${result.ticketId}?${new URLSearchParams({
      message: result.id,
      q: filters.q,
      returnTo: syncUrl ? address(filters) : returnPath,
    })}`;

  function select(index: number) {
    const result = data?.items[index];
    if (!result || loading) return;
    if (onSelect) onSelect(result, { filters, data: data!, index, cursor, previous });
    else router.push(resultUrl(result));
  }

  function page(next: boolean) {
    if (loading || !data) return;
    pending.current?.abort();
    setLoading(true);
    scrollPage.current = true;
    restoreResult.current = undefined;
    setActive(0);
    if (next && data.nextCursor) {
      setPrevious((value) => [...value, cursor]);
      setCursor(data.nextCursor);
    } else if (!next && previous.length) {
      setCursor(previous.at(-1));
      setPrevious((value) => value.slice(0, -1));
    }
  }

  const kinds: [SearchFilters['kind'], string][] = [
    ['all', 'همه'],
    ['text', 'متن'],
    ['files', 'فایل‌ها'],
    ['photos', 'عکس‌ها'],
    ['audio', 'صداها'],
    ['links', 'لینک‌ها'],
  ];
  return (
    <div
      className={`message-search-panel${inline ? ' message-search-inline' : ''}`}
      ref={panel}
      data-search-active={enabled || !!filters.q.trim() ? 'true' : undefined}
    >
      <div className="message-search-controls">
        <div className="message-search-input">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            ref={searchInput}
            aria-label={filters.ticketId ? 'جستجو در پیام‌های این گفتگو' : 'جستجو در همه پیام‌ها'}
            autoComplete="off"
            enterKeyHint="search"
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder="چه پیامی را پیدا کنیم؟"
            maxLength={200}
            value={filters.q}
            onChange={(e) => change({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Escape' && onClose) {
                e.preventDefault();
                onClose();
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                select(active);
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((value) =>
                  Math.max(0, Math.min((data?.items.length ?? 1) - 1, value + 1)),
                );
                const index = Math.max(0, Math.min((data?.items.length ?? 1) - 1, active + 1));
                searchInput.current
                  ?.closest('.message-search-panel')
                  ?.querySelector(`[data-search-result="${data?.items[index]?.id}"]`)
                  ?.scrollIntoView({ block: 'nearest' });
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((value) => Math.max(0, value - 1));
                const index = Math.max(0, active - 1);
                searchInput.current
                  ?.closest('.message-search-panel')
                  ?.querySelector(`[data-search-result="${data?.items[index]?.id}"]`)
                  ?.scrollIntoView({ block: 'nearest' });
              }
            }}
          />
          {onClose && (
            <button type="button" aria-label="بستن جستجو" onClick={onClose}>
              <ArrowRight size={18} />
            </button>
          )}
          {!!filters.q && (
            <button type="button" aria-label="پاک کردن جستجو" onClick={() => change({ q: '' })}>
              <X size={18} />
            </button>
          )}
        </div>
        {children && !resultsShown && (
          <button
            type="button"
            className="search-filter-toggle"
            aria-label="فیلترهای جستجو"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal size={16} /> فیلتر
          </button>
        )}
        {(resultsShown || filtersOpen) && (
          <>
            <div className="search-kind-tabs" role="group" aria-label="نوع پیام">
              {kinds.map(([kind, name]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={filters.kind === kind}
                  onClick={() => change({ kind })}
                >
                  {name}
                </button>
              ))}
            </div>
            <details className="message-search-filters">
              <summary>
                <SlidersHorizontal size={16} /> فیلترهای بیشتر
              </summary>
              <div className="search-filter-fields">
                <label>
                  روش جستجو
                  <Select
                    aria-label="روش جستجو"
                    value={filters.mode}
                    onValueChange={(mode) => change({ mode: mode as SearchFilters['mode'] })}
                    options={[
                      { value: 'all', label: 'همه واژه‌ها' },
                      { value: 'phrase', label: 'عبارت دقیق' },
                      { value: 'any', label: 'یکی از واژه‌ها' },
                    ]}
                  />
                </label>
                <label>
                  ترتیب نتایج
                  <Select
                    aria-label="ترتیب نتایج"
                    value={filters.sort}
                    onValueChange={(sort) => change({ sort: sort as SearchFilters['sort'] })}
                    options={[
                      { value: 'newest', label: 'جدیدترین پیام‌ها' },
                      { value: 'oldest', label: 'قدیمی‌ترین پیام‌ها' },
                    ]}
                  />
                </label>
                <label>
                  از تاریخ (میلادی)
                  <input
                    type="date"
                    aria-label="از تاریخ"
                    value={filters.from ?? ''}
                    onChange={(e) => change({ from: e.target.value || undefined })}
                  />
                </label>
                <label>
                  تا تاریخ (میلادی)
                  <input
                    type="date"
                    aria-label="تا تاریخ"
                    value={filters.to ?? ''}
                    onChange={(e) => change({ to: e.target.value || undefined })}
                  />
                </label>
                {privateAllowed && (
                  <label>
                    نمایش پیام‌ها
                    <Select
                      aria-label="نمایش پیام‌ها"
                      value={filters.visibility}
                      onValueChange={(visibility) =>
                        change({ visibility: visibility as SearchFilters['visibility'] })
                      }
                      options={[
                        { value: 'all', label: 'عمومی و خصوصی' },
                        { value: 'public', label: 'فقط عمومی' },
                        { value: 'internal', label: 'فقط خصوصی واحد' },
                      ]}
                    />
                  </label>
                )}
                <div className="search-from-buttons">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      change({ senderId: filters.senderId === actorId ? undefined : actorId });
                      setSenderName('پیام‌های من');
                    }}
                    aria-pressed={filters.senderId === actorId}
                  >
                    <UserRound size={15} /> پیام‌های من
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSenderOpen((value) => !value)}
                    aria-expanded={senderOpen}
                  >
                    انتخاب فرستنده
                  </Button>
                </div>
                {senderOpen && (
                  <SenderPicker
                    ticketId={filters.ticketId}
                    choose={(id, name) => {
                      change({ senderId: id });
                      setSenderName(name);
                      setSenderOpen(false);
                    }}
                  />
                )}
                <p className="search-syntax-hint">
                  برای عبارت دقیق از <bdi>&quot;ثبت نام&quot;</bdi> و برای حذف یک واژه از{' '}
                  <bdi>-لغو</bdi> استفاده کنید.
                </p>
              </div>
            </details>
            <div className="search-active-filters">
              {filters.ticketId && !onSelect && (
                <button type="button" onClick={() => change({ ticketId: undefined })}>
                  فقط این گفتگو <X size={14} />
                </button>
              )}
              {filters.departmentId && (
                <button type="button" onClick={() => change({ departmentId: undefined })}>
                  واحد انتخاب‌شده <X size={14} />
                </button>
              )}
              {filters.senderId && (
                <button type="button" onClick={() => change({ senderId: undefined })}>
                  {senderName || 'فرستنده انتخاب‌شده'} <X size={14} />
                </button>
              )}
              {(filters.from || filters.to) && (
                <button type="button" onClick={() => change({ from: undefined, to: undefined })}>
                  بازهٔ تاریخ <X size={14} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {resultsShown && (
        <div
          className="message-search-results"
          aria-label="نتایج جستجوی پیام‌ها"
          aria-busy={loading}
        >
          {loading && (
            <p role="status" className="search-status">
              در حال جستجو در پیام‌ها…
            </p>
          )}
          {error && (
            <div role="alert" className="error-message">
              {error}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLoading(true);
                  setCursor(undefined);
                  setPrevious([]);
                  setRevision((value) => value + 1);
                }}
              >
                تلاش دوباره
              </Button>
            </div>
          )}
          {!enabled && (
            <div className="search-empty">
              <Search size={32} />
              <p>
                {filters.q.trim()
                  ? 'حداقل دو حرف بنویسید.'
                  : 'در تمام پیام‌ها جستجو کنید یا نوع پیام را انتخاب کنید.'}
              </p>
            </div>
          )}
          {enabled && !loading && data && !data.items.length && (
            <p role="status" className="search-empty">
              پیامی پیدا نشد. عبارت یا فیلترها را تغییر دهید.
            </p>
          )}
          {enabled &&
            data?.items.map((result, index) => (
              <article
                key={result.id}
                className={`search-result ${active === index ? 'search-result-active' : ''}`}
                data-search-result={result.id}
              >
                {onSelect ? (
                  <button
                    className="search-result-main"
                    type="button"
                    disabled={loading}
                    onClick={() => select(index)}
                  >
                    <ResultContent result={result} terms={data.terms} showChat={!onSelect} />
                  </button>
                ) : (
                  <Link
                    prefetch={false}
                    className="search-result-main"
                    aria-disabled={loading}
                    tabIndex={loading ? -1 : undefined}
                    href={resultUrl(result)}
                    onClick={(event) => {
                      if (loading) event.preventDefault();
                    }}
                  >
                    <ResultContent result={result} terms={data.terms} showChat={!onSelect} />
                  </Link>
                )}
                <div className="search-result-actions">
                  {!onSelect && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => change({ ticketId: result.ticketId })}
                    >
                      فقط این گفتگو
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      change({ senderId: result.senderId });
                      setSenderName(result.senderName);
                    }}
                  >
                    پیام‌های این فرستنده
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
      {!resultsShown && children}
      {data && enabled && (
        <div className="message-search-footer">
          <span>
            {data.items.length
              ? `${digits(previous.length * 20 + 1)} تا ${digits(previous.length * 20 + data.items.length)} نتیجه`
              : ''}
          </span>
          <nav aria-label="صفحه‌بندی نتایج جستجو">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading || !previous.length}
              onClick={() => page(false)}
            >
              <ArrowUp size={16} /> صفحه قبل
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !data.nextCursor}
              onClick={() => page(true)}
            >
              نتایج بیشتر <ArrowDown size={16} />
            </Button>
          </nav>
        </div>
      )}
    </div>
  );
}

function ResultContent({
  result,
  terms,
  showChat,
}: {
  result: SearchResult;
  terms: string[];
  showChat: boolean;
}) {
  return (
    <>
      <span className="search-result-heading">
        <strong>{showChat ? result.chatName : result.senderName}</strong>
        <time>{dateTime(result.createdAt)}</time>
      </span>
      {showChat && <span className="search-result-sender">{result.senderName}</span>}
      {result.visibility === 'INTERNAL' && (
        <span className="search-private">
          <Lock size={13} /> خصوصی واحد
        </span>
      )}
      <span className="search-result-excerpt">
        <SearchHighlight text={result.excerpt} terms={terms} />
      </span>
      {result.attachments.map((file) => (
        <span key={file.id} className="search-result-file">
          <Paperclip size={14} />
          <bdi>
            <SearchHighlight text={file.filename} terms={terms} />
          </bdi>
        </span>
      ))}
      <span className="search-open-message">مشاهده در گفتگو</span>
    </>
  );
}
