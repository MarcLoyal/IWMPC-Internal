const manila = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in the Philippines, as YYYY-MM-DD. */
export function todayManila(now: Date = new Date()): string {
  return manila.format(now);
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** YYYY-MM-DD -> Date at UTC midnight, the form Prisma uses for DATE columns. */
export function toDbDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** DATE column -> YYYY-MM-DD. */
export function fromDbDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** "2026-11-12" -> "Nov 12, 2026" */
export function formatDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
