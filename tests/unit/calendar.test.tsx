// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { iranDateValue, jalaliDateLabel, validCalendarDate } from '../../apps/web/src/lib/calendar';
import { DatePicker, DateRange } from '../../apps/web/src/components/ui/date-picker';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('validates date-only values and displays the Iranian leap day and Nowruz in Persian', () => {
  expect(jalaliDateLabel('2025-03-20')).toBe('۳۰ اسفند ۱۴۰۳');
  expect(jalaliDateLabel('2025-03-21')).toBe('۱ فروردین ۱۴۰۴');
  expect(jalaliDateLabel('2026-03-21')).toBe('۱ فروردین ۱۴۰۵');
  for (const value of [
    '',
    '1404/01/01',
    '2025-02-29',
    '2025-04-31',
    '2025-13-01',
    '2025-1-1',
    'invalid',
  ]) {
    expect(validCalendarDate(value)).toBe(false);
    expect(jalaliDateLabel(value)).toBe('');
  }
  expect(validCalendarDate('2024-02-29')).toBe(true);
});

it('uses the Tehran day on either side of midnight rather than UTC or the device clock zone', () => {
  expect(iranDateValue(new Date('2025-03-20T20:29:59Z'))).toBe('2025-03-20');
  expect(iranDateValue(new Date('2025-03-20T20:30:00Z'))).toBe('2025-03-21');
  expect(iranDateValue(new Date('2025-03-21T23:59:59Z'))).toBe('2025-03-22');
});

it('selects a Jalali day, submits its compatible date-only value and clears it without submitting the form', () => {
  const submit = vi.fn();

  function Form() {
    const [value, setValue] = useState('2025-03-20');
    return (
      <form onSubmit={submit}>
        <DatePicker name="from" label="از تاریخ" value={value} onValueChange={setValue} />
      </form>
    );
  }

  const view = render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'از تاریخ، ۳۰ اسفند ۱۴۰۳' }));
  const dialog = screen.getByRole('dialog', { name: 'از تاریخ' });
  expect(
    within(dialog).getByRole('combobox', { name: 'ماه را انتخاب کنید' }).textContent,
  ).toContain('اسفند');
  expect(
    within(dialog).getByRole('combobox', { name: 'سال را انتخاب کنید' }).textContent,
  ).toContain('۱۴۰۳');
  fireEvent.click(within(dialog).getByRole('button', { name: /۲۹.*اسفند.*۱۴۰۳/ }));
  expect(new FormData(view.container.querySelector('form')!).get('from')).toBe('2025-03-19');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'از تاریخ، ۲۹ اسفند ۱۴۰۳' }));
  fireEvent.click(screen.getByRole('button', { name: 'پاک کردن تاریخ' }));
  expect(new FormData(view.container.querySelector('form')!).get('from')).toBe('');
});

it('disables days outside the date range and prevents Today from bypassing its bounds', () => {
  render(
    <DatePicker
      label="تا تاریخ"
      value="2025-03-20"
      min="2025-03-19"
      max="2025-03-21"
      onValueChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /تا تاریخ،/ }));
  expect(screen.getByRole('button', { name: /۲۸.*اسفند.*۱۴۰۳/ }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: /۲۹.*اسفند.*۱۴۰۳/ }).hasAttribute('disabled')).toBe(
    false,
  );
  expect(screen.getByRole('button', { name: 'امروز', exact: true }).hasAttribute('disabled')).toBe(
    true,
  );
});

it('respects externally cleared ranges and does not resurrect its previous local selection', () => {
  const change = vi.fn();
  const view = render(<DateRange from="2025-03-20" to="2025-03-21" onChange={change} />);
  view.rerender(<DateRange from="" to="" onChange={change} />);
  expect(screen.getByRole('button', { name: 'از تاریخ، انتخاب تاریخ' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'تا تاریخ، انتخاب تاریخ' })).toBeTruthy();
});

it('restores focus to the date trigger after the calendar moves focus into its selected day', async () => {
  render(<DatePicker label="از تاریخ" value="2025-03-20" onValueChange={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: 'از تاریخ، ۳۰ اسفند ۱۴۰۳' });
  trigger.focus();
  fireEvent.click(trigger);
  screen.getByRole('button', { name: /۳۰.*اسفند.*۱۴۰۳/ }).focus();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
