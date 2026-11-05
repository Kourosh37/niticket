'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Building2, Pencil, History, UserRound, Camera } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { Avatar } from './avatar';
import { AvatarUpload } from './avatar-upload';
import { UploadProgress } from './upload-progress';
import { useReauthentication } from './reauthentication';
import { request } from '@/lib/utils';
import { uploadAvatar } from '@/lib/upload';
import type { listDepartments } from '@niticket/core/application/administration';

type Department = Awaited<ReturnType<typeof listDepartments>>[number];
type Person = Department['memberships'][number]['user'];

function ResponsibleFields({ person }: { person?: Person }) {
  return (
    <>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="responsible-name">نام و نام خانوادگی مسئول</label>
          <input
            id="responsible-name"
            name="responsibleName"
            required
            minLength={2}
            maxLength={100}
            autoComplete="off"
            defaultValue={person?.name}
          />
        </div>
        <div className="field">
          <label htmlFor="responsible-username">نام کاربری مسئول</label>
          <input
            id="responsible-username"
            name="username"
            dir="ltr"
            required
            minLength={3}
            maxLength={40}
            autoComplete="off"
            defaultValue={person?.username ?? ''}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="responsible-email">ایمیل مسئول واحد</label>
          <input
            id="responsible-email"
            name="email"
            type="email"
            dir="ltr"
            required
            maxLength={254}
            autoComplete="off"
            defaultValue={person?.email}
            placeholder="name@stu.nit.ac.ir"
          />
        </div>
        <div className="field">
          <label htmlFor="responsible-phone">شماره همراه مسئول</label>
          <input
            id="responsible-phone"
            name="phone"
            type="tel"
            dir="ltr"
            required
            autoComplete="off"
            defaultValue={person?.phone ?? ''}
            placeholder="09123456789"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="responsible-password">
          {person ? 'رمز عبور جدید (اختیاری)' : 'رمز عبور مسئول'}
        </label>
        <input
          id="responsible-password"
          name="password"
          type="password"
          dir="ltr"
          required={!person}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
        <p className="field-hint">
          حداقل ۱۲ نویسه؛ مسئول با نام کاربری یا ایمیل و این رمز وارد می‌شود.
          {person ? ' برای حفظ رمز فعلی، این بخش را خالی بگذارید.' : ''}
        </p>
      </div>
    </>
  );
}

export function UnitManagement({ departments, q = '' }: { departments: Department[]; q?: string }) {
  const reauthentication = useReauthentication();
  const router = useRouter(),
    params = useSearchParams();
  const [create, setCreate] = useState(params.get('new') === '1'),
    [editing, setEditing] = useState<Department | null>(null),
    [person, setPerson] = useState<Person | null>(null),
    [photo, setPhoto] = useState<File | null>(null),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await reauthentication.run(fn);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'ذخیره اطلاعات انجام نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>واحدها و مسئولان</h1>
          <p>واحد و حساب مسئول آن را یک‌جا ایجاد و مدیریت کنید.</p>
        </div>
        <Button
          disabled={busy}
          onClick={() => {
            setCreate(true);
            setError('');
          }}
        >
          <Plus size={18} /> واحد جدید
        </Button>
      </div>
      {!create && !editing && !person && reauthentication.confirmation}
      <form className="surface filters" action="/admin/departments" style={{ marginBottom: 20 }}>
        <input
          type="search"
          name="q"
          aria-label="جستجوی واحدها"
          placeholder="نام واحد را جستجو کنید…"
          defaultValue={q}
          maxLength={100}
        />
        <Button variant="outline">جستجو</Button>
        {q && (
          <Link className="text-link" href="/admin/departments">
            همه واحدها
          </Link>
        )}
      </form>
      {error && !create && !person && !editing && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-message" role="status">
          {success}
        </p>
      )}
      {departments.length ? (
        departments.map((d) => (
          <article className="surface admin-card" key={d.id}>
            <div className="admin-card-header">
              <span className="department-icon">
                <Building2 size={22} />
              </span>
              <div style={{ flex: 1 }}>
                <h2>{d.name}</h2>
                <p>{d.description || 'واحد پاسخ‌گویی دانشگاه'}</p>
              </div>
              <span className="status">{d.active ? 'فعال' : 'غیرفعال'}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`ویرایش ${d.name}`}
                disabled={busy}
                onClick={() => {
                  setEditing(d);
                  setError('');
                }}
              >
                <Pencil size={17} />
              </Button>
            </div>
            {d.memberships.map((m) => (
              <div className="unit-person-row" key={m.id}>
                <Avatar name={m.user.name} image={m.user.image} />
                <div>
                  <strong>{m.user.name}</strong>
                  <p>
                    <bdi>{m.user.username || m.user.email}</bdi> ·{' '}
                    <bdi>{m.user.phone || 'شماره همراه ثبت نشده'}</bdi>
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPerson(m.user);
                    setError('');
                  }}
                  disabled={busy}
                >
                  <UserRound size={15} /> ویرایش مسئول
                </Button>
              </div>
            ))}
            <div className="upload-controls">
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/departments/${d.id}/history`}>
                  <History size={15} /> تاریخچه واحد
                </Link>
              </Button>
            </div>
            <details>
              <summary>دسته‌بندی درخواست‌ها</summary>
              {d.categories.map((c) => (
                <div key={c.id} className="member-row">
                  <span>{c.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('دسته‌بندی غیرفعال شود؟'))
                        void run(async () => {
                          await request(`/api/v1/admin/departments/${d.id}/categories`, {
                            method: 'POST',
                            body: JSON.stringify({ id: c.id, name: c.name, active: false }),
                          });
                        });
                    }}
                  >
                    غیرفعال‌سازی
                  </Button>
                </div>
              ))}
              <form
                className="upload-controls"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    name = new FormData(form).get('name');
                  void run(async () => {
                    await request(`/api/v1/admin/departments/${d.id}/categories`, {
                      method: 'POST',
                      body: JSON.stringify({ name }),
                    });
                    form.reset();
                  });
                }}
              >
                <input
                  name="name"
                  aria-label={`نام دسته‌بندی جدید برای ${d.name}`}
                  placeholder="نام دسته‌بندی جدید"
                  required
                  minLength={2}
                  maxLength={100}
                  style={{ maxWidth: 300 }}
                />
                <Button variant="outline" size="sm" disabled={busy}>
                  افزودن دسته‌بندی
                </Button>
              </form>
            </details>
          </article>
        ))
      ) : (
        <section className="surface empty-state">
          <Building2 size={32} />
          <h3>هنوز واحدی ایجاد نشده است</h3>
          <p>با ایجاد واحد و حساب مسئول آن، دانشجویان می‌توانند درخواست ثبت کنند.</p>
        </section>
      )}
      <Modal
        open={create}
        onOpenChange={(value) => {
          if (!busy) {
            setCreate(value);
            setPhoto(null);
          }
        }}
        title="ایجاد واحد و حساب مسئول"
        description="اطلاعات مسئول را از مسیر امن در اختیار او بگذارید."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              const result = await request<{ id: string; responsibleUserId: string }>(
                '/api/v1/admin/departments',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    name: f.get('name'),
                    description: f.get('description'),
                    responsible: {
                      name: f.get('responsibleName'),
                      username: f.get('username'),
                      email: f.get('email'),
                      phone: f.get('phone'),
                      password: f.get('password'),
                    },
                  }),
                },
              );
              setSuccess('واحد و حساب مسئول با موفقیت ایجاد شدند.');
              if (photo) {
                setProgress(0);
                try {
                  await uploadAvatar(photo, result.responsibleUserId, setProgress);
                } catch {
                  setSuccess(
                    'واحد و حساب مسئول ایجاد شد؛ تصویر بارگذاری نشد. از ویرایش مسئول دوباره تلاش کنید.',
                  );
                }
              }
              setProgress(null);
              setCreate(false);
              setPhoto(null);
              router.push(`/admin/departments?q=${encodeURIComponent(String(f.get('name')))}`);
            });
          }}
        >
          <fieldset className="form-fields" disabled={busy}>
            <div className="field">
              <label htmlFor="new-unit-name">نام واحد</label>
              <input id="new-unit-name" name="name" required minLength={2} maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="new-unit-description">توضیحات واحد (اختیاری)</label>
              <textarea id="new-unit-description" name="description" maxLength={1000} rows={2} />
            </div>
            <h3 className="form-subheading">حساب مسئول واحد</h3>
            <ResponsibleFields />
            <div className="field">
              <label htmlFor="unit-photo">
                <Camera size={15} style={{ display: 'inline' }} /> تصویر پروفایل مسئول (اختیاری)
              </label>
              <input
                id="unit-photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 2097152) {
                    setError('حداکثر حجم تصویر ۲ مگابایت است.');
                    e.target.value = '';
                    setPhoto(null);
                    return;
                  }
                  setPhoto(file ?? null);
                }}
              />
              <p className="field-hint">مسئول می‌تواند بعداً تصویر را در پروفایل خود تغییر دهد.</p>
            </div>
          </fieldset>
          {progress !== null && <UploadProgress percent={progress} label="بارگذاری تصویر مسئول" />}
          {reauthentication.confirmation}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <Button disabled={busy}>{busy ? 'در حال ایجاد…' : 'ایجاد واحد و مسئول'}</Button>
        </form>
      </Modal>
      <Modal
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
        title="ویرایش واحد"
      >
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await request(`/api/v1/admin/departments/${editing.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: f.get('name'),
                    description: f.get('description'),
                    active: f.has('active'),
                    visible: true,
                    acceptingTickets: f.has('acceptingTickets'),
                  }),
                });
                setEditing(null);
                setSuccess('اطلاعات واحد ذخیره شد.');
              });
            }}
          >
            <fieldset className="form-fields" disabled={busy}>
              <div className="field">
                <label htmlFor="edit-unit-name">نام واحد</label>
                <input
                  id="edit-unit-name"
                  name="name"
                  defaultValue={editing.name}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-unit-description">توضیحات</label>
                <textarea
                  id="edit-unit-description"
                  name="description"
                  defaultValue={editing.description}
                  maxLength={1000}
                />
              </div>
              <label className="checkbox-field">
                <input type="checkbox" name="active" defaultChecked={editing.active} /> واحد فعال
                باشد
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="acceptingTickets"
                  defaultChecked={editing.acceptingTickets}
                />{' '}
                درخواست جدید بپذیرد
              </label>
            </fieldset>
            {reauthentication.confirmation}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <Button disabled={busy}>ذخیره واحد</Button>
          </form>
        )}
      </Modal>
      <Modal
        open={!!person}
        onOpenChange={(open) => {
          if (!open && !busy) setPerson(null);
        }}
        title="ویرایش حساب مسئول واحد"
      >
        {person && (
          <>
            <AvatarUpload userId={person.id} name={person.name} image={person.image} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await request(`/api/v1/admin/users/${person.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      name: f.get('responsibleName'),
                      username: f.get('username'),
                      email: f.get('email'),
                      phone: f.get('phone'),
                      ...(f.get('password') ? { password: f.get('password') } : {}),
                    }),
                  });
                  setPerson(null);
                  setSuccess('اطلاعات مسئول ذخیره و نشست‌های قبلی او لغو شد.');
                });
              }}
            >
              <fieldset className="form-fields" disabled={busy}>
                <ResponsibleFields person={person} />
              </fieldset>
              {reauthentication.confirmation}
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
              <Button disabled={busy}>ذخیره حساب مسئول</Button>
            </form>
          </>
        )}
      </Modal>
    </>
  );
}
