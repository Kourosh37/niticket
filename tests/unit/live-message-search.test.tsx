// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageSearch, type SearchData } from '../../apps/web/src/components/message-search';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../apps/web/src/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  request.mockReset();
});

it('debounces typing, aborts superseded searches and ignores late responses after clearing', async () => {
  vi.useFakeTimers();
  const pending: { signal: AbortSignal; resolve: (data: SearchData) => void }[] = [];
  request.mockImplementation(
    (_url: string, options: { signal: AbortSignal }) =>
      new Promise<SearchData>((resolve) => pending.push({ signal: options.signal, resolve })),
  );
  render(<MessageSearch actorId="actor" privateAllowed={false} inline syncUrl={false} />);
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: 'fi' } });
  await act(() => vi.advanceTimersByTimeAsync(200));
  fireEvent.change(input, { target: { value: 'first' } });
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(request).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: 'second' } });
  expect(pending[0].signal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { value: '' } });
  expect(pending[1].signal.aborted).toBe(true);
  await act(async () => {
    for (const job of pending) job.resolve({ items: [], terms: [], nextCursor: null });
  });
  expect(screen.queryByText('پیامی پیدا نشد. عبارت یا فیلترها را تغییر دهید.')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('waits for text composition to finish before searching', async () => {
  vi.useFakeTimers();
  request.mockResolvedValue({ items: [], terms: [], nextCursor: null });
  render(<MessageSearch actorId="actor" privateAllowed={false} inline syncUrl={false} />);
  const input = screen.getByRole('searchbox');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'دانشگاه' } });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(request).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(request).toHaveBeenCalledTimes(1);
});
