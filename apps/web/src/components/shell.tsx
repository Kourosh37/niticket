'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Ticket,
  Plus,
  Bell,
  Building2,
  Users,
  LogOut,
  Menu,
  X,
  GraduationCap,
  ArrowUpLeft,
  Settings,
  ChevronLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { NotificationBell } from './notification-bell';
import { Avatar } from './avatar';
import { SessionGuard } from './session-guard';

type Props = {
  user: { name: string; isAdmin: boolean; staff: boolean; image?: string | null };
  universityName?: string;
  supportDescription?: string;
  children: React.ReactNode;
};

export function Shell({
  user,
  children,
  universityName = 'دانشگاه صنعتی نوشیروانی بابل',
  supportDescription = 'سامانه ارتباط و پشتیبانی دانشگاه',
}: Props) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const nodes = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') ?? [],
      );
    nodes()[0]?.focus();

    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const items = nodes();
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    }

    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [open]);
  const links = user.isAdmin
    ? [
        { href: '/', label: 'نمای کلی سامانه', icon: LayoutDashboard },
        { href: '/admin/departments', label: 'واحدها و مسئولان', icon: Building2 },
        { href: '/admin/users', label: 'مدیریت کاربران', icon: Users },
        { href: '/admin/settings', label: 'اطلاعات و تنظیمات سامانه', icon: Settings },
        { href: '/profile', label: 'حساب کاربری', icon: Settings },
      ]
    : user.staff
      ? [
          { href: '/', label: 'میز کار من', icon: LayoutDashboard },
          { href: '/workspace', label: 'درخواست‌های واحد', icon: Ticket },
          { href: '/notifications', label: 'اعلان‌ها', icon: Bell },
          { href: '/profile', label: 'پروفایل من', icon: Settings },
        ]
      : [
          { href: '/', label: 'نمای کلی', icon: LayoutDashboard },
          { href: '/tickets', label: 'درخواست‌های من', icon: Ticket },
          { href: '/notifications', label: 'اعلان‌ها', icon: Bell },
          { href: '/profile', label: 'حساب کاربری', icon: Settings },
        ];

  async function logout() {
    const res = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.ok || res.status === 401) {
      router.replace('/login');
      router.refresh();
    } else setError('خروج انجام نشد. دوباره تلاش کنید.');
  }

  return (
    <div className="app-frame">
      <SessionGuard />
      {open && (
        <button className="drawer-backdrop" aria-label="بستن منو" onClick={() => setOpen(false)} />
      )}
      <aside ref={sidebar} id="sidebar" className={cn('sidebar', open && 'sidebar-open')}>
        <Link href="/" className="brand">
          <span className="brand-mark">
            <GraduationCap size={25} />
          </span>
          <span>
            <strong>
              نیتیکت<span className="brand-dot">.</span>
            </strong>
            <small>سامانه پشتیبانی دانشگاه</small>
          </span>
        </Link>
        <div className="sidebar-university">
          <span className="tiny-label">{universityName}</span>
          <span className="university-tag">همراه شما، تا رسیدن به پاسخ</span>
        </div>
        {!user.isAdmin && !user.staff && (
          <Button asChild className="sidebar-create">
            <Link href="/tickets/new" onClick={() => setOpen(false)}>
              <Plus size={18} /> ثبت درخواست جدید <ChevronLeft size={16} />
            </Link>
          </Button>
        )}
        <p className="nav-label">فضای کار شما</p>
        <nav aria-label="ناوبری اصلی">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                'nav-item',
                (href === '/' ? path === '/' : path === href || path.startsWith(href + '/')) &&
                  'active',
              )}
            >
              <Icon size={19} />
              <span>{label}</span>
              {href === path && <i />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!user.isAdmin && (
            <div className="support-note">
              <span className="support-symbol">؟</span>
              <strong>برای شروع نیاز به راهنمایی دارید؟</strong>
              <p>
                {user.staff
                  ? 'درخواست‌های واحد را پاسخ دهید و روند رسیدگی را ثبت کنید.'
                  : 'واحد مربوط را انتخاب کنید و موضوع خود را با ما در میان بگذارید.'}
              </p>
              <Link href="/help">
                راهنمای سامانه <ArrowUpLeft size={14} />
              </Link>
            </div>
          )}
          <button className="account-row" onClick={() => router.push('/profile')}>
            <Avatar name={user.name} image={user.image} />
            <span>
              <b>{user.name}</b>
              <small>{user.isAdmin ? 'مدیر سامانه' : user.staff ? 'مسئول واحد' : 'دانشجو'}</small>
            </span>
            <Settings size={17} />
          </button>
          <button className="logout" onClick={logout}>
            <LogOut size={15} /> خروج از حساب
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu"
              aria-expanded={open}
              aria-controls="sidebar"
              aria-label={open ? 'بستن منو' : 'باز کردن منو'}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
            <span title={supportDescription}>{supportDescription}</span>
          </div>
          <div className="topbar-actions">
            <span className="today">
              {new Intl.DateTimeFormat('fa-IR', {
                dateStyle: 'long',
                timeZone: 'Asia/Tehran',
              }).format(new Date())}
            </span>
            <span className="topbar-divider" />
            {!user.isAdmin && <NotificationBell />}
            <Avatar name={user.name} image={user.image} small />
          </div>
        </header>
        <main id="main-content" className="page-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>نیتیکت · {universityName}</span>
          <span>ارتباطی روشن، پیگیری آسان</span>
        </footer>
      </div>
    </div>
  );
}
