/** Calendar values stay date-only; displaying them must never depend on the device's zone. */
export const IRAN_TIME_ZONE = 'Asia/Tehran';

export function validCalendarDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function iranDateValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: IRAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function jalaliDateLabel(value?: string): string {
  if (!validCalendarDate(value)) return '';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
    timeZone: IRAN_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00+03:30`));
}
