// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewTicket } from '../../apps/web/src/components/new-ticket';

const { request, replace } = vi.hoisted(() => ({ request: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));
const unit = (id: string, name = id) => ({
  id,
  name,
  description: '',
  acceptingTickets: true,
  canContinue: false,
});
const initial = { items: [unit('initial', 'آموزش')], nextCursor: null };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  request.mockReset();
  replace.mockReset();
});

it('always offers search even with one unit and waits for composition before sending a debounced query', async () => {
  vi.useFakeTimers();
  request.mockResolvedValue({ items: [unit('target', 'امور مالی')], nextCursor: null });
  render(<NewTicket initial={initial} />);
  const input = screen.getByRole('searchbox', { name: 'جستجوی واحد' });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'مالی' } });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(request).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await act(() => vi.advanceTimersByTimeAsync(249));
  expect(request).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(new URL(request.mock.calls[0][0], 'http://localhost').searchParams.get('q')).toBe('مالی');
  expect(screen.getByRole('button', { name: 'انتخاب امور مالی' })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});

it('cancels old searches and ignores late results and errors, including after unmount', async () => {
  vi.useFakeTimers();
  const pending: { signal: AbortSignal; resolve: (data: typeof initial) => void }[] = [];
  request.mockImplementation(
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve) => pending.push({ signal, resolve })),
  );
  const view = render(<NewTicket initial={initial} />);
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: 'اول' } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  fireEvent.change(input, { target: { value: 'دوم' } });
  expect(pending[0].signal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(250));
  await act(async () => pending[1].resolve({ items: [unit('second')], nextCursor: null }));
  await act(async () => pending[0].resolve({ items: [unit('first')], nextCursor: null }));
  expect(screen.getByRole('button', { name: 'انتخاب second' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'انتخاب first' })).toBeNull();
  fireEvent.change(input, { target: { value: 'سوم' } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  view.unmount();
  expect(pending[2].signal.aborted).toBe(true);
});

it('keeps the query while paging, resets its cursor when clearing, and opens only an explicitly selected unit', async () => {
  vi.useFakeTimers();
  request
    .mockResolvedValueOnce({ items: [unit('one')], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [unit('two')], nextCursor: null })
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ id: 'conversation' });
  render(<NewTicket initial={initial} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'واحد' } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  fireEvent.click(screen.getByRole('button', { name: 'واحدهای بیشتر' }));
  await act(() => vi.advanceTimersByTimeAsync(250));
  const params = new URL(request.mock.calls[1][0], 'http://localhost').searchParams;
  expect(params.get('q')).toBe('واحد');
  expect(params.get('cursor')).toBe('next');
  fireEvent.click(screen.getByRole('button', { name: 'پاک کردن جستجوی واحد' }));
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(new URL(request.mock.calls[2][0], 'http://localhost').searchParams.has('cursor')).toBe(
    false,
  );
  expect(screen.queryByRole('button', { name: 'واحدهای قبلی' })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'انتخاب آموزش' })));
  expect(request.mock.calls[3][0]).toBe('/api/v1/conversations');
  expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ departmentId: 'initial' });
  expect(replace).toHaveBeenCalledWith('/tickets/conversation');
});

it('shows an empty state and allows retry after network failure without enabling stale choices', async () => {
  vi.useFakeTimers();
  request
    .mockRejectedValueOnce(new Error('شبکه در دسترس نیست'))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<NewTicket initial={initial} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'پیدا نشد' } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(screen.getByRole('alert').textContent).toContain('شبکه در دسترس نیست');
  expect(screen.getByRole('button', { name: 'انتخاب آموزش' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(screen.getByRole('status').textContent).toContain('واحدی با این نام پیدا نشد');
});
