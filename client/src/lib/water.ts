import type { BillStatus, RateSchedule } from './types';

/**
 * The same computation the server uses, so the amount can be shown while staff type a reading.
 * (The server always recomputes when saving; this is only a preview.) Works in centavos.
 */
export function computeWaterCharge(cubicMeters: number, rates: RateSchedule): number {
  const cents = (v: string) => Math.round(Number(v) * 100);
  const minimum = cents(rates.minimumCharge);
  const covered = rates.minimumCoversM3;
  if (cubicMeters <= covered || rates.tiers.length === 0) return minimum / 100;

  if (rates.method === 'PROGRESSIVE') {
    let amount = minimum;
    let lower = covered;
    for (const tier of rates.tiers) {
      const upper = tier.upTo ?? Infinity;
      const units = Math.min(cubicMeters, upper) - lower;
      if (units > 0) amount += units * cents(tier.rate);
      lower = upper;
      if (cubicMeters <= upper) break;
    }
    return amount / 100;
  }
  const tier = rates.tiers.find((t) => t.upTo === null || cubicMeters <= t.upTo) ?? rates.tiers[rates.tiers.length - 1];
  return (minimum + (cubicMeters - covered) * cents(tier.rate)) / 100;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10" -> "October 2026" */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2026-10" -> "Oct" */
export function monthShort(period: string): string {
  return MONTHS[Number(period.slice(5)) - 1].slice(0, 3);
}

export function currentPeriod(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);
}

export const BILL_STATUS: Record<BillStatus, { label: string; tone: 'green' | 'yellow' | 'red' | 'gray' }> = {
  PAID: { label: 'Paid', tone: 'green' },
  DUE_SOON: { label: 'Due soon', tone: 'yellow' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  UNPAID: { label: 'Not yet due', tone: 'gray' },
};

export const RATE_CLASS = {
  RESIDENTIAL: 'Residential & Institutional',
  COMMERCIAL: 'Commercial & Industrial',
} as const;

/** The cu.m range of each block, for showing a rate table: "0 - 5", "6 - 10", ..., "Over 40". */
export function blockLabels(rates: RateSchedule): string[] {
  const labels: string[] = [];
  let from = rates.minimumCoversM3 + 1;
  for (const tier of rates.tiers) {
    labels.push(tier.upTo === null ? `Over ${from - 1}` : `${from} - ${tier.upTo}`);
    if (tier.upTo !== null) from = tier.upTo + 1;
  }
  return labels;
}
