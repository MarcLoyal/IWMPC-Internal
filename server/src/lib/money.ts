import { Prisma } from '@prisma/client';

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

/** Parses "1250", "1,250.50" etc. into an exact decimal. Returns null if it isn't a valid peso amount. */
export function parseMoney(input: string): Prisma.Decimal | null {
  const cleaned = input.replace(/[₱,\s]/g, '');
  if (!MONEY.test(cleaned)) return null;
  return new Prisma.Decimal(cleaned);
}

/** ₱1,250.00 */
export function formatPeso(value: Prisma.Decimal | string | number): string {
  const [whole, cents] = new Prisma.Decimal(value).toFixed(2).split('.');
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
