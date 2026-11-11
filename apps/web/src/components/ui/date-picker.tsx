'use client';

import { useId, useState } from 'react';
import { DayPicker } from '@daypicker/persian';
import { TZDate, type DropdownProps } from '@daypicker/react';
import { CalendarDays } from 'lucide-react';
import { IRAN_TIME_ZONE, iranDateValue, jalaliDateLabel, validCalendarDate } from '@/lib/calendar';
import { Modal } from './dialog';
import { Button } from './button';
import { Select } from './select';

function calendarDay(value?: string) {
  return validCalendarDate(value)
    ? new TZDate(new Date(`${value}T12:00:00+03:30`), IRAN_TIME_ZONE)
    : undefined;
}

function CalendarDropdown({ options = [], value, onChange, 'aria-label': label }: DropdownProps) {
  return (
    <Select
      aria-label={label}
      value={String(value)}
      options={options.map((option) => ({ ...option, value: String(option.value) }))}
      onValueChange={(next) =>
        onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>)
      }
    />
  );
}

export function DatePicker({
  label,
  value = '',
  onValueChange,
  name,
  min,
  max,
}: {
  label: string;
  value?: string;
  onValueChange: (value: string) => void;
  name?: string;
  min?: string;
  max?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = calendarDay(value);
  const today = iranDateValue();
  const todayAllowed = (!min || today >= min) && (!max || today <= max);

  function choose(next: string) {
    onValueChange(next);
    setOpen(false);
  }

  return (
    <div className="date-picker-field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        id={id}
        type="button"
        className="date-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}، ${jalaliDateLabel(value) || 'انتخاب تاریخ'}`}
        onClick={() => setOpen(true)}
      >
        <CalendarDays size={19} aria-hidden="true" />
        <span>{jalaliDateLabel(value) || 'انتخاب تاریخ'}</span>
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={label}
        description="تقویم هجری شمسی · به وقت ایران"
        className="date-picker-dialog"
      >
        {open && (
          <DayPicker
            className="jalali-calendar"
            mode="single"
            selected={selected}
            defaultMonth={selected ?? calendarDay(min) ?? calendarDay(max) ?? calendarDay(today)}
            onSelect={(date) => {
              if (date) choose(iranDateValue(date));
            }}
            timeZone={IRAN_TIME_ZONE}
            weekStartsOn={6}
            captionLayout="dropdown"
            navLayout="around"
            startMonth={calendarDay('1900-01-01')}
            endMonth={calendarDay('2100-12-31')}
            disabled={[
              ...(min && calendarDay(min) ? [{ before: calendarDay(min)! }] : []),
              ...(max && calendarDay(max) ? [{ after: calendarDay(max)! }] : []),
            ]}
            fixedWeeks
            showOutsideDays
            autoFocus
            components={{ Dropdown: CalendarDropdown }}
          />
        )}
        <div className="date-picker-actions">
          <Button
            type="button"
            variant="outline"
            disabled={!todayAllowed}
            onClick={() => choose(today)}
          >
            امروز
          </Button>
          <Button type="button" variant="ghost" disabled={!value} onClick={() => choose('')}>
            پاک کردن تاریخ
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function DateRange({
  from,
  to,
  defaultFrom = '',
  defaultTo = '',
  onChange,
  named = false,
}: {
  from?: string;
  to?: string;
  defaultFrom?: string;
  defaultTo?: string;
  onChange?: (range: { from?: string; to?: string }) => void;
  named?: boolean;
}) {
  const [start, setStart] = useState(defaultFrom);
  const [end, setEnd] = useState(defaultTo);
  const currentFrom = from ?? start;
  const currentTo = to ?? end;
  return (
    <fieldset className="date-range-fields">
      <legend>بازه زمانی</legend>
      <DatePicker
        label="از تاریخ"
        name={named ? 'from' : undefined}
        value={currentFrom}
        max={currentTo}
        onValueChange={(value) => {
          setStart(value);
          onChange?.({ from: value || undefined, to: currentTo || undefined });
        }}
      />
      <DatePicker
        label="تا تاریخ"
        name={named ? 'to' : undefined}
        value={currentTo}
        min={currentFrom}
        onValueChange={(value) => {
          setEnd(value);
          onChange?.({ from: currentFrom || undefined, to: value || undefined });
        }}
      />
    </fieldset>
  );
}
