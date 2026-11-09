'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getServerTheme, getTheme, setTheme, subscribeTheme } from '@/lib/theme';

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      className="theme-toggle"
      aria-label="حالت تاریک"
      aria-checked={dark}
      title={dark ? 'فعال کردن تم روشن' : 'فعال کردن تم تاریک'}
      onClick={() => setTheme(getTheme() === 'dark' ? 'light' : 'dark')}
    >
      {dark ? <Sun size={21} aria-hidden="true" /> : <Moon size={21} aria-hidden="true" />}
    </button>
  );
}
