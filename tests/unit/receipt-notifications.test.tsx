// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMessageReceipts } from '../../apps/web/src/lib/use-message-receipts';
import {
  NotificationStatus,
  ConversationNavigation,
} from '../../apps/web/src/components/notification-status';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/tickets/test' }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  request.mockReset();
});

function VisibleReply() {
  useMessageReceipts('ticket', ['reply'], [], true);
  return <ConversationNavigation />;
}

it('refreshes the shared unread counter immediately after a visible reply dismisses its notification', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  let unread = 1;
  request.mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) {
      unread = 0;
      return { updated: 1, notificationsRead: 1 };
    }
    return { unreadCount: unread };
  });
  await act(async () => {
    render(
      <NotificationStatus>
        <VisibleReply />
      </NotificationStatus>,
    );
  });
  expect(screen.getByRole('status').textContent).toBe('۱ اعلان خوانده‌نشده');
  await act(() => vi.advanceTimersByTimeAsync(450));
  expect(screen.getByRole('status').textContent).toBe('');
  expect(request.mock.calls.filter(([url]) => url === '/api/v1/notifications/count')).toHaveLength(
    2,
  );
});
