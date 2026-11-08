'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { request } from '@/lib/utils';
import { AvatarUpload } from './avatar-upload';
import { useReauthentication } from './reauthentication';
import { LogOut } from 'lucide-react';
import { AccountSessions } from './account-sessions';

export function Profile({
  profile,
}: {
  profile: {
    name: string;
    phoneNumber: string | null;
    hasPassword: boolean;
    role?: string;
    image?: string | null;
  };
}) {
  const router = useRouter();
  const reauthentication = useReauthentication();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="easy-profile">
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
            <label htmlFor="profile-phone">شماره موبایل</label>
            <input
              id="profile-phone"
              type="tel"
              dir="ltr"
              value={profile.phoneNumber?.replace('+98', '0') ?? ''}
              readOnly
            />
          </div>
        </div>
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
            await reauthentication.run(() =>
              request('/api/v1/users/me/password', {
                method: 'POST',
                body: JSON.stringify({ newPassword: f.get('next') }),
              }),
            );
            setSuccess('رمز عبور تغییر کرد و نشست‌های دیگر لغو شدند.');
            form.reset();
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'تغییر رمز انجام نشد.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 style={{ marginBottom: 24 }}>
          {profile.hasPassword ? 'تغییر رمز عبور' : 'انتخاب رمز عبور'}
        </h2>
        <div className="form-grid">
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
        {reauthentication.confirmation}
        <Button disabled={busy} variant="outline">
          ذخیره رمز عبور
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
      <AccountSessions />
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
    </div>
  );
}
