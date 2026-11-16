import { Prisma, type Payment, type Sale, type SaleItem } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { formatDate, fromDbDate, toDbDate, todayManila } from '../lib/dates';
import { normalizeOr } from '../lib/orNumbers';
import { audit } from './audit';
import { getSettings } from './settings';

export const WALK_IN = 'Walk-in customer';

/** "2 sacks" style text is avoided on purpose: units are free text, so we write "2 x per sack (25 kg)". */
export function quantityText(quantity: Prisma.Decimal): string {
  return quantity.toDecimalPlaces(2).toString();
}

export function itemsSummary(items: Pick<SaleItem, 'productName' | 'unitLabel' | 'quantity'>[]): string {
  return items.map((i) => `${i.productName}, ${quantityText(i.quantity)} × ${i.unitLabel}`).join('; ');
}

export interface SaleItemInput {
  unitId: number;
  quantity: Prisma.Decimal;
}

export interface NewSale {
  /** Empty for a walk-in customer. */
  accountId: number | null;
  walkInName: string;
  items: SaleItemInput[];
  /** Required for a cash sale; a credit sale has no OR number until it is paid. */
  orNumber: string;
  credit: boolean;
}

/** The price a buyer pays for one unit: the member price for members when one is set. */
export function priceFor(unit: { price: Prisma.Decimal; memberPrice: Prisma.Decimal | null }, isMember: boolean): Prisma.Decimal {
  return isMember && unit.memberPrice !== null ? unit.memberPrice : unit.price;
}

async function orAlreadyUsed(db: Db, orNumber: string): Promise<AppError> {
  const existing = await db.payment.findUnique({
    where: { orNumber },
    include: { account: { select: { fullName: true } }, sale: { select: { walkInName: true } } },
  });
  if (!existing) return new AppError(409, `OR number ${orNumber} was already used.`);
  const who = existing.account?.fullName ?? (existing.sale?.walkInName || WALK_IN);
  const voided = existing.status === 'VOID' ? ' (that payment was voided)' : '';
  return new AppError(
    409,
    `OR number ${orNumber} was already used for ${who} on ${formatDate(fromDbDate(existing.paymentDate)!)}${voided}. Please check the receipt booklet.`,
  );
}

/** The one place that says "this OR number was already used", for every kind of payment. */
export async function assertOrFree(db: Db, orNumber: string) {
  if (await db.payment.findUnique({ where: { orNumber }, select: { id: true } })) throw await orAlreadyUsed(db, orNumber);
}
export { orAlreadyUsed };

/**
 * Records a Rice & LPG sale with one or more items.
 * Cash: saved together with one payment under one OR number.
 * Credit: only when "Allow credit" is on, only for an account, and with no payment yet.
 */
export async function createSale(input: NewSale, userId: number) {
  if (!input.items.length) throw new AppError(400, 'Please add at least one item to the sale.');
  if (input.items.some((i) => i.quantity.lte(0))) throw new AppError(400, 'Please enter a quantity greater than zero.');
  const orNumber = normalizeOr(input.orNumber);
  if (input.credit) {
    const settings = await getSettings(prisma);
    if (settings.allow_credit !== 'true') throw new AppError(400, 'Credit sales are turned off. This sale must be paid in cash.');
    if (!input.accountId) throw new AppError(400, 'A walk-in customer cannot buy on credit. Please pick an account.');
  } else if (!orNumber) {
    throw new AppError(400, 'Please enter the OR number from the receipt booklet.');
  }
  const saleDate = todayManila();

  try {
    return await prisma.$transaction(async (tx) => {
      const account = input.accountId ? await tx.account.findUnique({ where: { id: input.accountId } }) : null;
      if (input.accountId && !account) throw notFound('This account');
      if (!input.credit) await assertOrFree(tx, orNumber);

      const units = await tx.productUnit.findMany({
        where: { id: { in: input.items.map((i) => i.unitId) } },
        include: { product: true },
      });
      let total = new Prisma.Decimal(0);
      const lines = input.items.map((item) => {
        const unit = units.find((u) => u.id === item.unitId);
        if (!unit || !unit.active || !unit.product.active) throw new AppError(400, 'One of the items is no longer sold. Please remove it and pick again.');
        // The price is fixed here and copied onto the sale.
        const unitPrice = priceFor(unit, account?.isMember ?? false);
        if (unitPrice.lte(0)) {
          throw new AppError(400, `The price of ${unit.product.name} (${unit.label}) has not been set yet. An Admin must set it in Settings first.`);
        }
        const amount = unitPrice.times(item.quantity).toDecimalPlaces(2);
        total = total.plus(amount);
        return { productUnitId: unit.id, productName: unit.product.name, unitLabel: unit.label, quantity: item.quantity, unitPrice, amount };
      });

      const sale = await tx.sale.create({
        data: {
          accountId: account?.id ?? null,
          walkInName: account ? '' : input.walkInName.trim(),
          saleDate: toDbDate(saleDate),
          total,
          isCredit: input.credit,
          settledOn: input.credit ? null : toDbDate(saleDate),
          createdById: userId,
          items: { create: lines },
        },
        include: { items: true },
      });
      await audit(tx, userId, 'sale.create', 'sale', sale.id, null, sale);

      let payment: Payment | null = null;
      if (!input.credit) {
        payment = await tx.payment.create({
          data: {
            accountId: account?.id ?? null,
            type: 'RICE_LPG',
            amount: total,
            orNumber,
            paymentDate: toDbDate(saleDate),
            saleId: sale.id,
            description: itemsSummary(lines),
            createdById: userId,
          },
        });
        await audit(tx, userId, 'payment.create', 'payment', payment.id, null, payment);
      }
      return { sale, payment };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw await orAlreadyUsed(prisma, orNumber);
    throw err;
  }
}

type SaleWithPayments = Sale & { payments: Pick<Payment, 'amount' | 'status' | 'paymentDate'>[] };

/** What is still owed on a sale. Voided payments never count. */
export function saleBalance(sale: SaleWithPayments): Prisma.Decimal {
  const paid = sale.payments.filter((p) => p.status === 'ACTIVE').reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  return Prisma.Decimal.max(new Prisma.Decimal(0), sale.total.minus(paid));
}

/** Call after a payment on a credit sale is saved or voided. */
export async function refreshSaleSettled(tx: Prisma.TransactionClient, saleId: number) {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { payments: true } });
  const dates = sale.payments.filter((p) => p.status === 'ACTIVE').map((p) => fromDbDate(p.paymentDate)!).sort();
  await tx.sale.update({
    where: { id: saleId },
    data: { settledOn: saleBalance(sale).isZero() && dates.length ? toDbDate(dates[dates.length - 1]) : null },
  });
}

/** Checks a payment toward a credit sale and returns the sale. */
export async function saleForPayment(tx: Prisma.TransactionClient, accountId: number, saleId: number | null, amount: Prisma.Decimal) {
  if (!saleId) {
    throw new AppError(400, 'To sell rice or LPG, pick "Rice & LPG" and add the items. To pay an earlier credit sale, click "Pay This" beside it.');
  }
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { payments: true } });
  if (!sale || sale.accountId !== accountId || !sale.isCredit) throw new AppError(400, 'This credit sale was not found on this account.');
  if (sale.status === 'VOID') throw new AppError(400, 'This sale was voided.');
  const balance = saleBalance(sale);
  if (balance.isZero()) throw new AppError(400, 'This credit sale is already fully paid.');
  if (amount.gt(balance)) throw new AppError(400, `The amount is more than what is owed for this sale (₱${balance.toFixed(2)}).`);
  return sale;
}

/** A payment was voided. A cash sale is voided with its payment; a credit sale just goes back to unpaid. */
export async function onSalePaymentVoided(tx: Prisma.TransactionClient, saleId: number, reason: string, userId: number) {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  if (sale.isCredit) {
    await refreshSaleSettled(tx, saleId);
    return;
  }
  const updated = await tx.sale.update({
    where: { id: saleId },
    data: { status: 'VOID', voidReason: reason, voidedAt: new Date(), voidedById: userId },
  });
  await audit(tx, userId, 'sale.void', 'sale', saleId, sale, updated);
}

/** Voids a credit sale that has no payments (a cash sale is voided by voiding its payment). */
export async function voidCreditSale(saleId: number, reason: string, userId: number) {
  if (!reason.trim()) throw new AppError(400, 'Please type the reason for voiding this sale.');
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { payments: true } });
    if (!sale) throw notFound('This sale');
    if (sale.status === 'VOID') throw new AppError(400, 'This sale was already voided.');
    if (sale.payments.some((p) => p.status === 'ACTIVE')) {
      throw new AppError(400, 'This sale has a payment. Void the payment first.');
    }
    const updated = await tx.sale.update({
      where: { id: saleId },
      data: { status: 'VOID', voidReason: reason.trim(), voidedAt: new Date(), voidedById: userId },
    });
    await audit(tx, userId, 'sale.void', 'sale', saleId, sale, updated);
    return updated;
  });
}

/** Credit sales on an account that still have a balance, oldest first. */
export async function unpaidCreditSales(db: Db, accountId: number) {
  const sales = await db.sale.findMany({
    where: { accountId, isCredit: true, status: 'ACTIVE', settledOn: null },
    include: { payments: true, items: true },
    orderBy: { id: 'asc' },
  });
  return sales.map((sale) => ({ sale, balance: saleBalance(sale) })).filter((s) => s.balance.gt(0));
}

/** Default products, added once when there are none. Prices start at zero until an Admin sets them. */
export type Category = 'RICE' | 'LPG' | 'OTHER';
export const CATEGORIES: Category[] = ['RICE', 'LPG', 'OTHER'];

export const DEFAULT_PRODUCTS: { name: string; category: Category; units: string[] }[] = [
  { name: 'Dinorado', category: 'RICE', units: ['per sack (25 kg)'] },
  { name: 'Sinandomeng', category: 'RICE', units: ['per sack (25 kg)'] },
  { name: 'LPG', category: 'LPG', units: ['per 11 kg tank (refill)'] },
];

export async function ensureDefaultProducts(db: Db) {
  if ((await db.product.count()) > 0) return;
  for (const [i, p] of DEFAULT_PRODUCTS.entries()) {
    await db.product.create({
      data: { name: p.name, category: p.category, sortOrder: i, units: { create: p.units.map((label, j) => ({ label, price: 0, sortOrder: j })) } },
    });
  }
}
