import { TZDate } from '@date-fns/tz';
import { IRAN_TIME_ZONE, validCalendarDate } from './calendar';

/** Reports accept inclusive UTC bounds; calendar filters identify civil days in Iran. */
export function iranDateBoundary(value?: string, endOfDay = false): string | undefined {
  if (!validCalendarDate(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const midnight = new TZDate(
    year,
    month - 1,
    day + (endOfDay ? 1 : 0),
    0,
    0,
    0,
    0,
    IRAN_TIME_ZONE,
  );
  return new Date(midnight.getTime() - (endOfDay ? 1 : 0)).toISOString();
}
