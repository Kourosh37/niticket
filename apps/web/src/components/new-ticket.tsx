'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Building2, Check, ChevronLeft, Search, Send } from 'lucide-react';
import { Button } from './ui/button';
import { request } from '@/lib/utils';

const schema = z.object({
  departmentId: z.string().min(1, 'یک واحد را انتخاب کنید.'),
  categoryId: z.string(),
  subject: z
    .string()
    .trim()
    .min(5, 'موضوع را کمی بیشتر توضیح دهید؛ حداقل ۵ حرف.')
    .max(180, 'موضوع حداکثر ۱۸۰ حرف باشد.'),
  body: z
    .string()
    .trim()
    .min(10, 'پیامتان را کمی بیشتر توضیح دهید؛ حداقل ۱۰ حرف.')
    .max(20000, 'پیام بیش از حد طولانی است.'),
});
type Department = {
  id: string;
  name: string;
  description: string;
  acceptingTickets: boolean;
  categories: { id: string; name: string }[];
};

export function NewTicket({
  departments,
  initialDepartment,
}: {
  departments: Department[];
  initialDepartment?: string;
}) {
  const router = useRouter();
  const initial = departments.find((d) => d.id === initialDepartment && d.acceptingTickets);
  const [step, setStep] = useState(initial ? 2 : 1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { departmentId: initial?.id ?? '', categoryId: '', subject: '', body: '' },
  });
  const departmentId = useWatch({ control, name: 'departmentId' });
  const department = departments.find((d) => d.id === departmentId);
  const shown = departments.filter(
    (d) => d.name.includes(search.trim()) || d.description.includes(search.trim()),
  );

  function choose(id: string) {
    if (id !== departmentId) setValue('categoryId', '');
    setValue('departmentId', id);
    setError('');
    setStep(2);
    requestAnimationFrame(() => setFocus('subject'));
  }

  async function submit(values: z.infer<typeof schema>) {
    setError('');
    try {
      const result = await request<{ id: string }>('/api/v1/tickets', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({
          ...values,
          priority: 'NORMAL',
          categoryId: values.categoryId || null,
        }),
      });
      router.push(`/tickets/${result.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ارسال انجام نشد. دوباره تلاش کنید.');
    }
  }

  return (
    <div className="easy-new-ticket">
      <Link href="/" className="easy-back">
        <ArrowRight size={20} /> گفتگوهای من
      </Link>
      <div className="new-ticket-heading">
        <h1>درخواست جدید</h1>
        <p>دو قدم کوتاه تا شروع گفتگو</p>
      </div>
      <ol className="easy-steps" aria-label="مراحل ارسال درخواست">
        <li aria-current={step === 1 ? 'step' : undefined}>
          <span>{step === 2 ? <Check size={17} /> : '۱'}</span>انتخاب واحد
        </li>
        <li aria-current={step === 2 ? 'step' : undefined}>
          <span>۲</span>نوشتن پیام
        </li>
      </ol>
      <div className="new-ticket-card">
        {step === 1 ? (
          <section aria-labelledby="choose-unit-title">
            <h2 id="choose-unit-title">به کدام واحد پیام می‌دهید؟</h2>
            <p className="new-step-hint">روی نام واحد موردنظرتان بزنید.</p>
            {departments.length > 5 && (
              <div className="unit-search">
                <Search size={20} />
                <input
                  aria-label="جستجوی واحد"
                  placeholder="نام واحد را بنویسید…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            <div className="unit-choices">
              {shown.map((d) => (
                <button
                  type="button"
                  key={d.id}
                  className="unit-choice"
                  disabled={!d.acceptingTickets}
                  onClick={() => choose(d.id)}
                  aria-label={`انتخاب ${d.name}`}
                >
                  <span className="unit-choice-icon">
                    <Building2 size={24} />
                  </span>
                  <span>
                    <strong>{d.name}</strong>
                    <small>
                      {d.acceptingTickets
                        ? d.description || 'ارسال پیام به این واحد'
                        : 'در حال حاضر درخواست جدید نمی‌پذیرد'}
                    </small>
                  </span>
                  <ChevronLeft size={21} />
                </button>
              ))}
            </div>
            {!shown.length && (
              <p className="new-no-units" role="status">
                {departments.length
                  ? 'واحدی با این نام پیدا نشد. نام کوتاه‌تری بنویسید.'
                  : 'هنوز واحدی برای دریافت پیام فعال نشده است.'}
              </p>
            )}
          </section>
        ) : (
          <form onSubmit={handleSubmit(submit)} noValidate>
            <div className="chosen-unit">
              <span className="unit-choice-icon">
                <Building2 size={23} />
              </span>
              <div>
                <small>پیام به</small>
                <strong>{department?.name}</strong>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={isSubmitting}
                onClick={() => setStep(1)}
              >
                تغییر واحد
              </Button>
            </div>
            <input type="hidden" {...register('departmentId')} />
            <h2>چه کمکی نیاز دارید؟</h2>
            <div className="field">
              <label htmlFor="subject">موضوع درخواست</label>
              <input
                id="subject"
                {...register('subject')}
                placeholder="مثلاً: مشکل در انتخاب واحد"
                maxLength={180}
                aria-invalid={!!errors.subject}
                aria-describedby={errors.subject ? 'subject-error' : undefined}
                disabled={isSubmitting}
              />
              {errors.subject && (
                <p id="subject-error" className="field-error" role="alert">
                  {errors.subject.message}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="body">شرح درخواست</label>
              <textarea
                id="body"
                {...register('body')}
                placeholder="اینجا بنویسید چه اتفاقی افتاده و چه کمکی می‌خواهید…"
                rows={5}
                maxLength={20000}
                aria-invalid={!!errors.body}
                aria-describedby={errors.body ? 'body-error' : undefined}
                disabled={isSubmitting}
              />
              {errors.body && (
                <p id="body-error" className="field-error" role="alert">
                  {errors.body.message}
                </p>
              )}
            </div>
            {!!department?.categories.length && (
              <details className="new-optional">
                <summary>دسته‌بندی پیام (اختیاری)</summary>
                <label htmlFor="categoryId" className="sr-only">
                  دسته‌بندی
                </label>
                <select id="categoryId" {...register('categoryId')} disabled={isSubmitting}>
                  <option value="">انتخاب نشده</option>
                  {department.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </details>
            )}
            <p className="new-attachment-hint">
              بعد از ارسال، می‌توانید عکس، فایل یا پیام صوتی هم بفرستید.
            </p>
            <div className="new-submit-bar">
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <Button
                className="new-submit"
                disabled={isSubmitting || !department?.acceptingTickets}
              >
                <Send size={20} />
                {isSubmitting ? 'در حال ارسال…' : 'ارسال درخواست'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
