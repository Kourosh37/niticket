'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Building2, ChevronLeft, LoaderCircle, Search } from 'lucide-react';
import { request } from '@/lib/utils';

type Department = {
  id: string;
  name: string;
  description: string;
  acceptingTickets: boolean;
  canContinue?: boolean;
};

export function NewTicket({
  departments,
  initialDepartment,
}: {
  departments: Department[];
  initialDepartment?: string;
}) {
  const router = useRouter();
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
  const initialId = departments.find(
    (d) => d.id === initialDepartment && (d.acceptingTickets || d.canContinue),
  )?.id;
  useEffect(() => {
    if (!initialId) return;
    const pending = setTimeout(() => void open(initialId), 0);
    return () => clearTimeout(pending);
  }, [initialId, open]);
  const shown = departments.filter((d) => `${d.name} ${d.description}`.includes(search.trim()));
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
        {departments.length > 5 && (
          <div className="unit-search">
            <Search size={20} />
            <input
              aria-label="جستجوی واحد"
              placeholder="نام واحد را بنویسید…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="unit-choices">
          {shown.map((d) => (
            <button
              type="button"
              key={d.id}
              className="unit-choice"
              disabled={!!openingId || !(d.acceptingTickets || d.canContinue)}
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
        {!shown.length && (
          <p className="new-no-units" role="status">
            {departments.length
              ? 'واحدی با این نام پیدا نشد.'
              : 'هنوز واحدی برای دریافت پیام فعال نشده است.'}
          </p>
        )}
      </section>
    </div>
  );
}
