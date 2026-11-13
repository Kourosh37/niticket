// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationDetails } from '../../apps/web/src/components/conversation-details';

const { request } = vi.hoisted(() => ({
  request: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  request.mockClear();
  vi.unstubAllGlobals();
});

function data(staff: boolean): Parameters<typeof ConversationDetails>[0]['data'] {
  return {
    ticket: {
      id: 'chat',
      creator: { id: 'student', name: 'Student', image: null },
      department: { id: 'unit', name: 'Unit' },
      createdAt: new Date(),
    },
    permissions: { staff, readOnly: false, manage: false, reopen: false, reply: true },
    responsible: null,
    activities: [],
    nextActivityCursor: null,
  };
}

it('keeps private history unavailable to requesters and does not fetch it when showing basic details', () => {
  render(
    <ConversationDetails
      open
      onOpenChange={() => {}}
      data={data(false)}
      maxBytes={1000}
      maxSeconds={180}
    />,
  );
  expect(screen.queryByText('تاریخچه و یادداشت‌های واحد')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it('loads history lazily after an authorized user expands it', async () => {
  render(
    <ConversationDetails
      open
      onOpenChange={() => {}}
      data={data(true)}
      maxBytes={1000}
      maxSeconds={180}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('تاریخچه و یادداشت‌های واحد'));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/tickets/chat/history'));
  await waitFor(() => expect(screen.queryByText('در حال دریافت تاریخچه…')).toBeNull());
});
