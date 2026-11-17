/** Billing months are written YYYY-MM. */
export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

/** "2026-10" -> "October 2026" */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM-DD plus a number of days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * A new bill's due date.
 * DAY_OF_NEXT_MONTH: day `day` of the month after the billing month (October -> November 15). If the
 * meters were read so late that this date has already passed, it moves to the same day one month on.
 * DAYS_AFTER_READING: `days` days after the reading date.
 */
export function dueDateFor(period: string, readDate: string, rule: string, day: number, days: number): string {
  if (rule === 'DAYS_AFTER_READING') return addDays(readDate, days);
  const d = Math.min(28, Math.max(1, day));
  let month = addMonths(period, 1);
  let due = `${month}-${String(d).padStart(2, '0')}`;
  while (due <= readDate) {
    month = addMonths(month, 1);
    due = `${month}-${String(d).padStart(2, '0')}`;
  }
  return due;
}
