'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Pencil } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { Avatar } from './avatar';
import { useReauthentication } from './reauthentication';
import { request } from '@/lib/utils';
import type { listUsers } from '@niticket/core/application/administration';

type User = Awaited<ReturnType<typeof listUsers>>['items'][number];
const roles: Record<string, string> = {
  STUDENT: 'دانشجو',
  STAFF: 'مسئول واحد',
  ADMIN: 'مدیر سامانه',
};

export function AdminUsers({
  data,
  q,
  actorId,
}: {
  data: Awaited<ReturnType<typeof listUsers>>;
  q: string;
  actorId: string;
}) {
  const router = useRouter();
  const reauthentication = useReauthentication();
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');

  async function save(id: string, changes: object) {
    if (busy) return false;
    setActiveUser(id);
    setBusy(true);
    setError('');
    try {
      await reauthentication.run(() =>
        request(`/api/v1/admin/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(changes),
        }),
      );
      router.refresh();
      setSuccess('اطلاعات کاربر ذخیره شد.');
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'عملیات انجام نشد.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>مدیریت کاربران</h1>
          <p>اطلاعات و وضعیت حساب‌های دانشجو، مسئول واحد و مدیر سامانه</p>
        </div>
      </div>
      {error && !editing && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="success-message">
          {success}
        </p>
      )}
      <section className="surface">
        <form className="filters">
          <div className="search-field">
            <Search size={17} />
            <input
              name="q"
              aria-label="جستجوی کاربران"
              placeholder="نام یا شماره موبایل…"
              maxLength={100}
              defaultValue={q}
            />
          </div>
          <Button variant="outline">جستجو</Button>
        </form>
        {data.items.map((user) => (
          <article key={user.id} className="admin-card user-management-row">
            <div className="admin-card-header">
              <Avatar name={user.name} image={user.image} />
              <div style={{ flex: 1 }}>
                <h3>{user.name}</h3>
                <p>
                  <bdi>{user.phoneNumber?.replace('+98', '0') ?? 'شماره ثبت نشده'}</bdi>
                </p>
              </div>
              <span className="status">
                {roles[user.isAdmin ? 'ADMIN' : user.role]} · {user.active ? 'فعال' : 'غیرفعال'}
              </span>
            </div>
            <div className="upload-controls">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setEditing(user);
                  setError('');
                }}
              >
                <Pencil size={14} /> ویرایش اطلاعات
              </Button>
              {user.id !== actorId && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        user.active
                          ? 'حساب غیرفعال و نشست‌های ورود لغو شوند؟'
                          : 'حساب دوباره فعال شود؟',
                      )
                    )
                      void save(user.id, { active: !user.active });
                  }}
                >
                  {user.active ? 'غیرفعال‌سازی حساب' : 'فعال‌سازی حساب'}
                </Button>
              )}
            </div>
            {!editing && activeUser === user.id && reauthentication.confirmation}
          </article>
        ))}
        {!data.items.length && (
          <div className="empty-state">
            <h3>کاربری با این اطلاعات پیدا نشد.</h3>
          </div>
        )}
        {data.nextCursor && (
          <div className="pagination">
            <Button asChild variant="outline">
              <Link href={`/admin/users?cursor=${data.nextCursor}&q=${encodeURIComponent(q)}`}>
                کاربران بعدی
              </Link>
            </Button>
          </div>
        )}
      </section>
      <Modal
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
        title="ویرایش اطلاعات کاربر"
      >
        {editing && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const changes = {
                name: f.get('name'),
                ...(f.get('phoneNumber') ? { phoneNumber: f.get('phoneNumber') } : {}),
              };
              if (await save(editing.id, changes)) setEditing(null);
            }}
          >
            <fieldset className="form-fields" disabled={busy}>
              <div className="field">
                <label htmlFor="edit-user-name">نام و نام خانوادگی</label>
                <input
                  id="edit-user-name"
                  name="name"
                  defaultValue={editing.name}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-user-phone">شماره موبایل</label>
                <input
                  id="edit-user-phone"
                  name="phoneNumber"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  dir="ltr"
                  defaultValue={editing.phoneNumber ?? ''}
                  maxLength={40}
                />
                <p className="field-hint">
                  تغییر شماره، رمز و نشست‌های قبلی را لغو می‌کند؛ ورود بعدی با کد موبایل است.
                </p>
              </div>
            </fieldset>
            {reauthentication.confirmation}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <Button disabled={busy}>ذخیره اطلاعات کاربر</Button>
          </form>
        )}
      </Modal>
    </>
  );
}
