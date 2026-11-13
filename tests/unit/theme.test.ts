// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getTheme,
  setTheme,
  subscribeTheme,
  THEME_KEY,
  themeBootstrap,
} from '../../apps/web/src/lib/theme';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});

afterEach(() => {
  localStorage.clear();
  document.cookie = `${THEME_KEY}=; Path=/; Max-Age=0`;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('resolves the theme before paint, prioritizes explicit preferences and tolerates blocked storage', () => {
  const run = (storage: Pick<Storage, 'getItem'>, dark = true) =>
    new Function('document', 'localStorage', 'matchMedia', themeBootstrap)(
      document,
      storage,
      () => ({ matches: dark }),
    );
  document.documentElement.dataset.themePreference = 'system';
  run({
    getItem: () => {
      throw new Error('Blocked');
    },
  });
  expect(getTheme()).toBe('dark');
  document.documentElement.dataset.themePreference = 'light';
  run({ getItem: () => 'dark' });
  expect(getTheme()).toBe('light');
  document.documentElement.dataset.themePreference = 'system';
  run({ getItem: () => 'invalid' }, false);
  expect(getTheme()).toBe('light');
});

it('persists a choice, syncs tabs, follows the system only when unselected and removes listeners', () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal('matchMedia', () => media);
  const listener = vi.fn();
  document.documentElement.dataset.themePreference = 'system';
  const unsubscribe = subscribeTheme(listener);
  media.dispatchEvent(new Event('change'));
  expect(getTheme()).toBe('dark');
  setTheme('light');
  expect(localStorage.getItem(THEME_KEY)).toBe('light');
  expect(document.cookie).toContain(`${THEME_KEY}=light`);
  media.dispatchEvent(new Event('change'));
  expect(getTheme()).toBe('light');
  window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));
  expect(getTheme()).toBe('dark');
  unsubscribe();
  listener.mockClear();
  setTheme('light');
  expect(listener).not.toHaveBeenCalled();
});

it('switches immediately even when storage writes fail', () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  setTheme('dark');
  expect(getTheme()).toBe('dark');
  expect(document.cookie).toContain(`${THEME_KEY}=dark`);
});

it('reconciles preferences changed before the tab attaches its storage listener', () => {
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.themePreference = 'dark';
  localStorage.setItem(THEME_KEY, 'light');
  const unsubscribe = subscribeTheme(vi.fn());
  expect(getTheme()).toBe('light');
  expect(document.cookie).toContain(`${THEME_KEY}=light`);
  unsubscribe();
  localStorage.clear();
  document.documentElement.dataset.themePreference = 'system';
  const stop = subscribeTheme(vi.fn());
  expect(getTheme()).toBe('light');
  stop();
});
