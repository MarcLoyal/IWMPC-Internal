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

/** Prices the items for a buyer (member price for members). Shared by sales and the invoice preview. */
export async function priceItems(db: Db, items: SaleItemInput[], isMember: boolean) {
  if (!items.length) throw new AppError(400, 'Please add at least one item to the sale.');
  if (items.some((i) => i.quantity.lte(0))) throw new AppError(400, 'Please enter a quantity greater than zero.');
  const units = await db.productUnit.findMany({ where: { id: { in: items.map((i) => i.unitId) } }, include: { product: true } });
  let total = new Prisma.Decimal(0);
  const lines = items.map((item) => {
    const unit = units.find((u) => u.id === item.unitId);
    if (!unit || !unit.active || !unit.product.active) throw new AppError(400, 'One of the items is no longer sold. Please remove it and pick again.');
    // The price is fixed here and copied onto the sale.
    const unitPrice = priceFor(unit, isMember);
    if (unitPrice.lte(0)) {
      throw new AppError(400, `The price of ${unit.product.name} (${unit.label}) has not been set yet. An Admin must set it in Settings first.`);
    }
    const amount = unitPrice.times(item.quantity).toDecimalPlaces(2);
    total = total.plus(amount);
    return { productUnitId: unit.id, productName: unit.product.name, unitLabel: unit.label, quantity: item.quantity, unitPrice, amount };
  });
  return { lines, total };
}

/** Saves a Rice & LPG sale inside an open transaction. The invoice adds its payment (if cash). */
export async function addSale(
  tx: Prisma.TransactionClient,
  input: { accountId: number | null; walkInName: string; items: SaleItemInput[]; credit: boolean; saleDate: string },
  userId: number,
) {
  const account = input.accountId ? await tx.account.findUnique({ where: { id: input.accountId } }) : null;
  if (input.accountId && !account) throw notFound('This account');
  const { lines, total } = await priceItems(tx, input.items, account?.isMember ?? false);
  const sale = await tx.sale.create({
    data: {
      accountId: account?.id ?? null,
      walkInName: account ? '' : input.walkInName.trim(),
      saleDate: toDbDate(input.saleDate),
      total,
      isCredit: input.credit,
      settledOn: input.credit ? null : toDbDate(input.saleDate),
      createdById: userId,
      items: { create: lines },
    },
    include: { items: true },
  });
  await audit(tx, userId, 'sale.create', 'sale', sale.id, null, sale);
  return sale;
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
    // Its charge invoice is cancelled too; the number is never used again.
    await tx.invoice.updateMany({
      where: { saleId, status: 'ACTIVE' },
      data: { status: 'VOID', cancelReason: reason.trim(), cancelledAt: new Date(), cancelledById: userId },
    });
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
