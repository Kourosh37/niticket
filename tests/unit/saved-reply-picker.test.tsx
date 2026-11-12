// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SavedReplyPicker } from '../../apps/web/src/components/saved-replies';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  request.mockReset();
});

it('shows loading before the first fetch, blocks stale choices as soon as search changes and ignores an aborted response', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const reply = {
    id: 'reply',
    title: 'راهنمای ثبت نام',
    body: 'متن پاسخ',
    version: 1,
    attachments: [],
  };
  const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  request.mockImplementation(
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve) => pending.push({ signal, resolve })),
  );
  render(<SavedReplyPicker departmentId="unit" onSend={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('در حال دریافت');
  expect(screen.queryByText('برای این واحد هنوز پیام آماده‌ای ندارید.')).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(250));
  await act(async () => pending[0].resolve({ items: [reply], nextCursor: null }));
  const choice = screen.getByRole('button', { name: 'انتخاب راهنمای ثبت نام' });
  expect(choice.hasAttribute('disabled')).toBe(false);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'اول' } });
  expect(
    screen.getByRole('button', { name: 'انتخاب راهنمای ثبت نام' }).hasAttribute('disabled'),
  ).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(250));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'دوم' } });
  expect(pending[1].signal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(250));
  await act(async () => pending[2].resolve({ items: [], nextCursor: null }));
  await act(async () => pending[1].resolve({ items: [reply], nextCursor: null }));
  expect(screen.queryByRole('button', { name: 'انتخاب راهنمای ثبت نام' })).toBeNull();
  expect(screen.getByText('پیامی پیدا نشد.')).toBeTruthy();
});
