import { Prisma, type RateSchedule } from '@prisma/client';
import type { Db } from '../lib/prisma';
import { AppError } from '../lib/errors';

export type RateClass = 'RESIDENTIAL' | 'COMMERCIAL';
export const RATE_CLASSES: RateClass[] = ['RESIDENTIAL', 'COMMERCIAL'];
export const RATE_CLASS_LABEL: Record<RateClass, string> = {
  RESIDENTIAL: 'Residential & Institutional',
  COMMERCIAL: 'Commercial & Industrial',
};

export type RateMethod = 'BLOCK' | 'PROGRESSIVE';

/** A consumption block above the minimum. `upTo` is the last cu.m in the block; null = no limit. */
export interface Tier {
  upTo: number | null;
  rate: string;
}

export interface RateTerms {
  minimumCharge: Prisma.Decimal | string;
  minimumCoversM3: number;
  tiers: Tier[];
  method: RateMethod;
}

/**
 * Computes the water charge for a month's consumption.
 *
 * BLOCK is how IWMPC bills (checked against its customer cards): the minimum charge covers the
 * first cu.m, and EVERY cu.m above that is charged at the rate of the block the total falls in.
 *   22 cu.m residential = 89.00 + (22 - 5) x 24.80 = 510.60
 *
 * PROGRESSIVE charges each block at its own rate:
 *   22 cu.m residential = 89.00 + 5 x 19.50 + 10 x 21.30 + 2 x 24.80 = 449.10
 */
export function computeWaterCharge(cubicMeters: number, terms: RateTerms): Prisma.Decimal {
  const minimum = new Prisma.Decimal(terms.minimumCharge);
  const covered = terms.minimumCoversM3;
  if (cubicMeters <= covered || terms.tiers.length === 0) return minimum.toDecimalPlaces(2);

  if (terms.method === 'PROGRESSIVE') {
    let amount = minimum;
    let lower = covered;
    for (const tier of terms.tiers) {
      const upper = tier.upTo ?? Infinity;
      const units = Math.min(cubicMeters, upper) - lower;
      if (units > 0) amount = amount.plus(new Prisma.Decimal(tier.rate).times(units));
      lower = upper;
      if (cubicMeters <= upper) break;
    }
    return amount.toDecimalPlaces(2);
  }

  const tier = terms.tiers.find((t) => t.upTo === null || cubicMeters <= t.upTo) ?? terms.tiers[terms.tiers.length - 1];
  return minimum.plus(new Prisma.Decimal(tier.rate).times(cubicMeters - covered)).toDecimalPlaces(2);
}

export function termsOf(schedule: RateSchedule): RateTerms {
  return {
    minimumCharge: schedule.minimumCharge,
    minimumCoversM3: schedule.minimumCoversM3,
    tiers: schedule.tiers as unknown as Tier[],
    method: schedule.method === 'PROGRESSIVE' ? 'PROGRESSIVE' : 'BLOCK',
  };
}

/** The rate version that applies to a billing month: the newest one starting on or before it. */
export async function scheduleFor(db: Db, rateClass: string, period: string): Promise<RateSchedule> {
  const schedule = await db.rateSchedule.findFirst({
    where: { rateClass, effectiveFrom: { lte: period } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!schedule) {
    const label = RATE_CLASS_LABEL[rateClass as RateClass] ?? rateClass;
    throw new AppError(400, `There are no ${label} water rates for this month. An Admin must set them in Settings first.`);
  }
  return schedule;
}

/** IWMPC's approved tariff (CPC No. 06-0622, June 22, 2022), 1/2 inch pipe. */
export const APPROVED_TARIFF: Record<RateClass, Omit<RateTerms, 'method'>> = {
  RESIDENTIAL: {
    minimumCharge: '89.00',
    minimumCoversM3: 5,
    tiers: [
      { upTo: 10, rate: '19.50' },
      { upTo: 20, rate: '21.30' },
      { upTo: 30, rate: '24.80' },
      { upTo: 40, rate: '28.30' },
      { upTo: null, rate: '31.90' },
    ],
  },
  COMMERCIAL: {
    minimumCharge: '531.00',
    minimumCoversM3: 15,
    tiers: [
      { upTo: 30, rate: '49.60' },
      { upTo: 500, rate: '70.80' },
      { upTo: 1000, rate: '88.70' },
      { upTo: null, rate: '99.30' },
    ],
  },
};

/** Adds the approved tariff if there are no water rates at all yet. */
export async function ensureDefaultRates(db: Db) {
  if ((await db.rateSchedule.count()) > 0) return;
  for (const rateClass of RATE_CLASSES) {
    const t = APPROVED_TARIFF[rateClass];
    await db.rateSchedule.create({
      data: {
        rateClass,
        effectiveFrom: '2022-07',
        minimumCharge: t.minimumCharge,
        minimumCoversM3: t.minimumCoversM3,
        tiers: t.tiers as unknown as Prisma.InputJsonValue,
        method: 'BLOCK',
        note: 'Approved tariff, CPC No. 06-0622 (June 22, 2022)',
      },
    });
  }
}
