'use client';

import Link from 'next/link';
import { Bell, ChevronLeft, HelpCircle, Moon, Search } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { UnreadBadge } from './notification-status';

export function SettingsPreferences({
  universityName,
  supportDescription,
}: {
  universityName: string;
  supportDescription: string;
}) {
  return (
    <section className="surface settings-preferences" aria-label="تنظیمات برنامه">
      <div className="settings-preference-row">
        <Moon size={22} />
        <div>
          <h2>ظاهر برنامه</h2>
          <p>حالت روشن یا تاریک را انتخاب کنید.</p>
        </div>
        <ThemeToggle />
      </div>
      <Link href="/notifications" className="settings-preference-row">
        <span className="dock-icon">
          <Bell size={22} />
          <UnreadBadge />
        </span>
        <div>
          <strong>اعلان‌ها</strong>
          <p>پیام‌ها و خبرهای تازه را ببینید.</p>
        </div>
        <ChevronLeft size={19} />
      </Link>
      <Link href="/?search=1" className="settings-preference-row">
        <Search size={22} />
        <div>
          <strong>جستجو در همه پیام‌ها</strong>
          <p>در همان فهرست گفتگوها جستجو کنید.</p>
        </div>
        <ChevronLeft size={19} />
      </Link>
      <Link href="/help" className="settings-preference-row">
        <HelpCircle size={22} />
        <div>
          <strong>راهنمای استفاده</strong>
        </div>
        <ChevronLeft size={19} />
      </Link>
      <div className="settings-application-info">
        <strong>نیتیکت</strong>
        <span>{universityName}</span>
        <small>{supportDescription}</small>
      </div>
    </section>
  );
}
