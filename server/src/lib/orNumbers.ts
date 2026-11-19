/** OR numbers are compared without surrounding spaces and without regard to letter case. */
export function normalizeOr(value: string): string {
  return value.trim().toUpperCase();
}

export interface OrGap {
  /** The OR numbers on either side of the gap, as written. */
  after: string;
  before: string;
  /** The missing OR numbers (capped so a typo like 10450 doesn't flood the report). */
  missing: string[];
  missingCount: number;
}

const MAX_LISTED = 20;

/**
 * Finds skipped OR numbers in one day's receipts, e.g. 1045, 1046, 1048 -> 1047 is missing.
 * ORs are grouped by their non-numeric prefix so two booklets ("A-101", "B-7") don't
 * create false gaps. ORs that don't end in digits are ignored.
 */
export function findOrGaps(orNumbers: string[]): OrGap[] {
  const groups = new Map<string, { n: bigint; width: number; raw: string }[]>();
  for (const raw of orNumbers) {
    const m = /^(.*?)(\d+)$/.exec(normalizeOr(raw));
    if (!m) continue;
    const list = groups.get(m[1]) ?? [];
    list.push({ n: BigInt(m[2]), width: m[2].length, raw: normalizeOr(raw) });
    groups.set(m[1], list);
  }

  const gaps: OrGap[] = [];
  for (const [prefix, list] of groups) {
    list.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const diff = cur.n - prev.n;
      if (diff <= 1n) continue;
      const missingCount = Number(diff - 1n);
      const missing: string[] = [];
      for (let k = 1n; k < diff && missing.length < MAX_LISTED; k++) {
        missing.push(prefix + String(prev.n + k).padStart(prev.width, '0'));
      }
      gaps.push({ after: prev.raw, before: cur.raw, missing, missingCount });
    }
  }
  return gaps;
}

/** The number shown to people: an invoice's later payments are stored as "28101#2", shown as "28101". */
export function displayNumber(stored: string): string {
  return stored.replace(/#\d+$/, '');
}
