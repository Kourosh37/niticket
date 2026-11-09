// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  NotificationStatus,
  ConversationNavigation,
  UnreadInboxNotice,
} from '../../apps/web/src/components/notification-status';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  request.mockReset();
});

it('shares one poll, coalesces notifications and cancels work when the signed-in shell unmounts', async () => {
  vi.useFakeTimers();
  const pending: { signal: AbortSignal; resolve: (data: { unreadCount: number }) => void }[] = [];
  request.mockImplementation(
    (_url: string, options: { signal: AbortSignal }) =>
      new Promise((resolve) => pending.push({ signal: options.signal, resolve })),
  );
  const view = render(
    <NotificationStatus>
      <ConversationNavigation />
      <UnreadInboxNotice />
    </NotificationStatus>,
  );
  expect(request).toHaveBeenCalledTimes(1);
  act(() => {
    window.dispatchEvent(new Event('notifications:changed'));
    window.dispatchEvent(new Event('notifications:changed'));
  });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => pending[0].resolve({ unreadCount: 3 }));
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toBe('۳ اعلان خوانده‌نشده');
  expect(screen.getByRole('link').textContent).toContain('۳ اعلان جدید دارید');
  await act(async () => pending[1].resolve({ unreadCount: 0 }));
  expect(screen.queryByRole('link')).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(request).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(pending[2].signal.aborted).toBe(true);
  await act(async () => pending[2].resolve({ unreadCount: 9 }));
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(request).toHaveBeenCalledTimes(3);
});
