'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { request, checkSession } from '@/lib/utils';
import { AvatarUpload } from './avatar-upload';
import { LogOut } from 'lucide-react';

export function Profile({
  profile,
}: {
  profile: {
    name: string;
    email: string;
    phone: string | null;
    emailNotifications: boolean;
    role?: string;
    image?: string | null;
    username?: string | null;
    studentNumber?: string | null;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>حساب کاربری</h1>
          <p>اطلاعات شخصی و تنظیمات امنیت حساب شما</p>
        </div>
      </div>
      <form
        className="surface form-surface"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const f = new FormData(e.currentTarget);
          try {
            await request('/api/v1/users/me', {
              method: 'PATCH',
              body: JSON.stringify({
                name: f.get('name'),
                phone: f.get('phone'),
                emailNotifications: f.has('emailNotifications'),
              }),
            });
            setSuccess('اطلاعات حساب شما ذخیره شد.');
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'ذخیره انجام نشد.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 style={{ marginBottom: 24 }}>اطلاعات حساب</h2>
        {profile.role === 'STAFF' && <AvatarUpload name={profile.name} image={profile.image} />}
        {profile.studentNumber && (
          <p className="field-hint">
            شماره دانشجویی: <bdi>{profile.studentNumber}</bdi>
          </p>
        )}
        {profile.username && profile.role === 'STAFF' && (
          <p className="field-hint">
            نام کاربری: <bdi>{profile.username}</bdi>
          </p>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">نام و نام خانوادگی</label>
            <input
              id="name"
              name="name"
              defaultValue={profile.name}
              required
              minLength={2}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="profile-email">ایمیل دانشگاهی</label>
            <input id="profile-email" type="email" dir="ltr" value={profile.email} disabled />
          </div>
        </div>
        <div className="field">
          <label htmlFor="phone">
            {profile.role === 'STAFF' ? 'شماره همراه' : 'شماره همراه (اختیاری)'}
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required={profile.role === 'STAFF'}
            dir="ltr"
            defaultValue={profile.phone ?? ''}
            placeholder="09123456789"
          />
        </div>
        <label className="checkbox-field">
          <input
            name="emailNotifications"
            type="checkbox"
            defaultChecked={profile.emailNotifications}
          />{' '}
          دریافت اعلان‌های ایمیلی
        </label>
        <Button disabled={busy}>ذخیره اطلاعات</Button>
      </form>
      <form
        className="surface form-surface"
        style={{ marginTop: 22 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setSuccess('');
          setBusy(true);
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            const res = await fetch('/api/auth/change-password', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                currentPassword: f.get('current'),
                newPassword: f.get('next'),
                revokeOtherSessions: true,
              }),
            });
            checkSession(res);
            if (!res.ok) throw new Error('رمز فعلی معتبر نیست یا رمز جدید شرایط لازم را ندارد.');
            setSuccess('رمز عبور تغییر کرد و نشست‌های دیگر لغو شدند.');
            form.reset();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'تغییر رمز انجام نشد.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 style={{ marginBottom: 24 }}>تغییر رمز عبور</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="current">رمز عبور فعلی</label>
            <input
              id="current"
              name="current"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </div>
          <div className="field">
            <label htmlFor="next-password">رمز عبور جدید</label>
            <input
              id="next-password"
              name="next"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </div>
        </div>
        <Button disabled={busy} variant="outline">
          تغییر رمز عبور
        </Button>
      </form>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-message" role="status">
          {success}
        </p>
      )}
      <div className="easy-profile-signout">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await fetch('/api/auth/sign-out', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
              });
              if (!response.ok && response.status !== 401)
                throw new Error('خروج انجام نشد. دوباره تلاش کنید.');
              router.replace('/login');
              router.refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'ارتباط برقرار نشد.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <LogOut size={18} />
          خروج از حساب
        </Button>
      </div>
    </>
  );
}
