'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
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
  MessageCircle,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { roleLabels } from '@/lib/role-labels';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { Avatar } from './avatar';
import { SessionGuard } from './session-guard';
import { DownloadScope } from './downloads';
import { ThemeToggle } from './theme-toggle';
import { NotificationStatus, ConversationNavigation } from './notification-status';
import { RealtimeProvider } from './realtime-provider';
import dynamic from 'next/dynamic';

const MessageSearch = dynamic(() =>
  import('./message-search').then((module) => module.MessageSearch),
);

type Props = {
  user: { id: string; name: string; isAdmin: boolean; staff: boolean; image?: string | null };
  universityName?: string;
  supportDescription?: string;
  children: React.ReactNode;
};

export function Shell(props: Props) {
  return (
    <RealtimeProvider key={props.user.id} userId={props.user.id}>
      <ShellContent {...props} />
    </RealtimeProvider>
  );
}

function ShellContent({
  user,
  children,
  universityName = 'دانشگاه صنعتی نوشیروانی بابل',
  supportDescription = 'سامانه ارتباط و پشتیبانی دانشگاه',
}: Props) {
  const path = usePathname();
  const router = useRouter();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [searchPath, setSearchPath] = useState<string | null>(null);
  const [navigationPath, setNavigationPath] = useState(path);
  if (navigationPath !== path) {
    setNavigationPath(path);
    setMenuPath(null);
    setSearchPath(null);
  }
  const open = menuPath === path;
  const globalSearch = searchPath === path;
  const setOpen = useCallback((value: boolean) => setMenuPath(value ? path : null), [path]);
  const inboxRoute = !user.isAdmin && ['/', '/tickets', '/workspace'].includes(path);

  function openSearch() {
    const field = document.querySelector<HTMLInputElement>(
      '#main-content .message-search-input input',
    );
    if (field) {
      field.focus();
      field.scrollIntoView({ block: 'nearest' });
    } else if (inboxRoute) {
      const params = new URLSearchParams(window.location.search);
      params.set('search', '1');
      router.replace(`${path}?${params}`, { scroll: false });
    } else setSearchPath((previous) => (previous === path ? null : path));
  }

  const search = globalSearch && !inboxRoute && !/^\/tickets\/(?!new$)[^/]+$/.test(path) && (
    <section className="shell-inline-search" aria-label="جستجو در همه پیام‌ها">
      <MessageSearch
        actorId={user.id}
        privateAllowed={user.staff || user.isAdmin}
        inline
        syncUrl={false}
        returnPath={path}
        onClose={() => setSearchPath(null)}
      />
    </section>
  );
  const [error, setError] = useState('');
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');

    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setMenuPath(null);
    }

    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
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
    try {
      const res = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.ok || res.status === 401) {
        router.replace('/login');
        router.refresh();
      } else setError('خروج انجام نشد. دوباره تلاش کنید.');
    } catch {
      setError('ارتباط برقرار نشد. برای خروج دوباره تلاش کنید.');
    }
  }

  if (!user.isAdmin) {
    const chatPage = /^\/tickets\/(?!new$)[^/]+$/.test(path);
    const navigation = [
      {
        href: '/',
        label: 'گفتگوها',
        icon: MessageCircle,
        active:
          path === '/' ||
          path === '/tickets' ||
          path === '/notifications' ||
          path.startsWith('/workspace') ||
          (path.startsWith('/tickets/') && path !== '/tickets/new'),
      },
      ...(!user.staff
        ? [
            {
              href: '/tickets/new',
              label: 'پیام جدید',
              icon: Plus,
              active: path === '/tickets/new',
            },
          ]
        : []),
      {
        href: '/settings',
        label: 'تنظیمات',
        icon: Settings,
        active: path === '/settings' || path === '/profile' || path === '/saved-replies',
      },
    ];
    return (
      <NotificationStatus key={user.id}>
        <div className={cn('easy-app', chatPage && 'messenger-app')}>
          <SessionGuard />
          <DownloadScope key={user.id} />
          <main id="main-content" className={cn('easy-main', chatPage && 'messenger-main')}>
            {search}
            {children}
          </main>
          <nav
            className={cn('easy-navigation', chatPage && 'navigation-chat')}
            aria-label="ناوبری اصلی"
          >
            {navigation.map(({ href, label, icon: Icon, active }) => (
              <Link href={href} key={href} aria-current={active ? 'page' : undefined}>
                {href === '/' ? (
                  <ConversationNavigation />
                ) : (
                  <>
                    <Icon size={23} />
                    <span>{label}</span>
                  </>
                )}
              </Link>
            ))}
          </nav>
          {error && (
            <p role="alert" className="easy-shell-error">
              {error}
            </p>
          )}
        </div>
      </NotificationStatus>
    );
  }

  const sidebarContent = (
    <>
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
        <button
          className="account-row"
          onClick={() => {
            setOpen(false);
            router.push('/profile');
          }}
        >
          <Avatar name={user.name} image={user.image} />
          <span>
            <b>{user.name}</b>
            <small>{roleLabels[user.isAdmin ? 'ADMIN' : user.staff ? 'STAFF' : 'STUDENT']}</small>
          </span>
          <Settings size={17} />
        </button>
        <button className="logout" onClick={logout}>
          <LogOut size={15} /> خروج از حساب
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </>
  );

  return (
    <div className="app-frame">
      <SessionGuard />
      <DownloadScope key={user.id} />
      <aside id="sidebar" className="admin-desktop-sidebar">
        {sidebarContent}
      </aside>
      <Modal
        open={open}
        onOpenChange={setOpen}
        id="mobile-administration-menu"
        title="منوی مدیریت"
        description="دسترسی به بخش‌های سامانه و حساب کاربری"
        presentation="drawer"
        className="admin-mobile-drawer"
      >
        {sidebarContent}
      </Modal>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu"
              aria-expanded={open}
              aria-controls="mobile-administration-menu"
              aria-haspopup="dialog"
              aria-label={open ? 'بستن منو' : 'باز کردن منو'}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
            <span title={supportDescription}>{supportDescription}</span>
          </div>
          <div className="topbar-actions">
            {!/^\/tickets\/(?!new$)[^/]+$/.test(path) && <ThemeToggle />}
            {!/^\/tickets\/(?!new$)[^/]+$/.test(path) && (
              <button
                type="button"
                onClick={openSearch}
                className="icon-link"
                aria-label="جستجو در همه پیام‌ها"
              >
                <Search size={21} />
              </button>
            )}
            <span className="today">
              {new Intl.DateTimeFormat('fa-IR', {
                dateStyle: 'long',
                timeZone: 'Asia/Tehran',
              }).format(new Date())}
            </span>
            <span className="topbar-divider" />
            <Avatar name={user.name} image={user.image} small />
          </div>
        </header>
        <main id="main-content" className="page-content">
          {search}
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
