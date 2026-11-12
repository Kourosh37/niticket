import { expect, it } from 'vitest';
import { iranDateBoundary } from '../../apps/web/src/lib/iran-date-boundary';
import { iranDateValue } from '../../apps/web/src/lib/calendar';

it.each([
  ['2025-07-20', '2025-07-19T20:30:00.000Z', '2025-07-20T20:29:59.999Z'],
  ['2020-07-20', '2020-07-19T19:30:00.000Z', '2020-07-20T19:29:59.999Z'],
  ['2021-03-22', '2021-03-21T20:30:00.000Z', '2021-03-22T19:29:59.999Z'],
  ['2021-09-21', '2021-09-20T19:30:00.000Z', '2021-09-21T20:29:59.999Z'],
])(
  'maps all of the Iranian day %s, including historical 23 and 25-hour days',
  (day, start, end) => {
    expect(iranDateBoundary(day)).toBe(start);
    expect(iranDateBoundary(day, true)).toBe(end);
    expect(iranDateValue(new Date(start))).toBe(day);
    expect(iranDateValue(new Date(end))).toBe(day);
    expect(iranDateValue(new Date(new Date(start).getTime() - 1))).not.toBe(day);
    expect(iranDateValue(new Date(new Date(end).getTime() + 1))).not.toBe(day);
  },
);

it('ignores invalid query values instead of producing an invalid timestamp', () => {
  for (const value of [undefined, '', '2025-02-30', '1404/01/01', 'not-a-date']) {
    expect(iranDateBoundary(value)).toBeUndefined();
    expect(iranDateBoundary(value, true)).toBeUndefined();
  }
});
