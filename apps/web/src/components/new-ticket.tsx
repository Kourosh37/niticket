'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Send, FileText, ChevronLeft } from 'lucide-react';
import { Button } from './ui/button';
import { request, digits } from '@/lib/utils';

const schema = z.object({
  departmentId: z.string().min(1, 'واحد پاسخ‌گو را انتخاب کنید.'),
  categoryId: z.string(),
  subject: z
    .string()
    .trim()
    .min(5, 'عنوان باید حداقل ۵ نویسه باشد.')
    .max(180, 'عنوان بیش از حد طولانی است.'),
  body: z
    .string()
    .trim()
    .min(10, 'شرح درخواست باید حداقل ۱۰ نویسه باشد.')
    .max(20000, 'شرح درخواست بیش از حد طولانی است.'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']),
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
  const [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      departmentId: initialDepartment ?? '',
      categoryId: '',
      subject: '',
      body: '',
      priority: 'NORMAL',
    },
  });
  // Form choices are presentation only; services revalidate department/category/priority.
  const departmentId = useWatch({ control, name: 'departmentId' });
  const department = departments.find((d) => d.id === departmentId);

  async function submit(values: z.infer<typeof schema>) {
    setError('');
    try {
      const result = await request<{ id: string }>('/api/v1/tickets', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({ ...values, categoryId: values.categoryId || null }),
      });
      router.push(`/tickets/${result.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت درخواست انجام نشد.');
    }
  }

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">خانه</Link>
        <ChevronLeft size={12} />
        <Link href="/tickets">درخواست‌ها</Link>
        <ChevronLeft size={12} />
        <span>درخواست جدید</span>
      </div>
      <div className="page-heading">
        <div>
          <h1>درخواست جدید</h1>
          <p>موضوع را با ما در میان بگذارید؛ از همین‌جا پیگیری خواهیم کرد.</p>
        </div>
      </div>
      <form className="surface form-surface" onSubmit={handleSubmit(submit)} noValidate>
        <div className="form-heading">
          <span>
            <FileText size={21} />
          </span>
          <div>
            <h2>اطلاعات درخواست</h2>
            <p>فیلدهای زیر به ما کمک می‌کنند سریع‌تر راهنمایی‌تان کنیم.</p>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="departmentId">
              واحد پاسخ‌گو <span aria-hidden="true">*</span>
            </label>
            <select
              id="departmentId"
              {...register('departmentId')}
              aria-invalid={!!errors.departmentId}
            >
              <option value="">انتخاب واحد دانشگاه</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.acceptingTickets}>
                  {d.name}
                  {!d.acceptingTickets ? ' (پذیرش غیرفعال)' : ''}
                </option>
              ))}
            </select>
            {errors.departmentId && (
              <p className="field-error" role="alert">
                {errors.departmentId.message}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="categoryId">دسته‌بندی</label>
            <select id="categoryId" {...register('categoryId')}>
              <option value="">انتخاب دسته‌بندی (اختیاری)</option>
              {department?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="subject">موضوع درخواست *</label>
          <input
            id="subject"
            {...register('subject')}
            placeholder="موضوع را کوتاه و روشن بنویسید"
            maxLength={180}
            aria-invalid={!!errors.subject}
          />
          {errors.subject && (
            <p className="field-error" role="alert">
              {errors.subject.message}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="body">شرح درخواست *</label>
          <textarea
            id="body"
            {...register('body')}
            rows={7}
            placeholder="چه موضوعی نیاز به بررسی دارد؟ جزئیات و اطلاعات لازم را اینجا بنویسید…"
            aria-invalid={!!errors.body}
          />
          {errors.body && (
            <p className="field-error" role="alert">
              {errors.body.message}
            </p>
          )}
          <p className="field-hint">
            رمز عبور و اطلاعات حساس غیرضروری را ننویسید. حداکثر {digits(20000)} نویسه.
          </p>
        </div>
        <div className="field">
          <label htmlFor="priority">اولویت</label>
          <select id="priority" {...register('priority')}>
            <option value="LOW">کم</option>
            <option value="NORMAL">عادی</option>
            <option value="HIGH">زیاد</option>
          </select>
        </div>
        <p className="field-hint">
          پس از ثبت، می‌توانید فایل، تصویر یا پیام صوتی را در صفحه گفتگو اضافه کنید.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => router.push('/tickets')}>
            انصراف
          </Button>
          <Button disabled={isSubmitting || !departments.length}>
            <Send size={17} />
            {isSubmitting ? 'در حال ثبت…' : 'ثبت و ادامه گفتگو'}
          </Button>
        </div>
      </form>
    </>
  );
}
