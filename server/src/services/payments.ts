import { Prisma, type PaymentType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { formatDate, fromDbDate, toDbDate, todayManila } from '../lib/dates';
import { normalizeOr } from '../lib/orNumbers';
import { audit } from './audit';
import { getSettings } from './settings';
import { assertCanPayMembershipFee, completeMembership, revokeMembership } from './membership';
import { periodLabel } from '../lib/periods';
import { billForPayment, billState, refreshBillSettled, unpaidBills } from './water';
import { itemsSummary, onSalePaymentVoided, orAlreadyUsed, refreshSaleSettled, saleForPayment, unpaidCreditSales } from './sales';

export interface NewPayment {
  accountId: number;
  type: PaymentType;
  amount: Prisma.Decimal;
  orNumber: string;
  description: string;
  /** For Water Bill payments: the bill being paid. Empty = the oldest unpaid bill. */
  waterBillId?: number | null;
  /** For Rice & LPG: the earlier credit sale being paid. (A new sale is saved through createSale.) */
  saleId?: number | null;
}

const duplicateOrError = orAlreadyUsed;

export async function recordPayment(input: NewPayment, userId: number) {
  const orNumber = normalizeOr(input.orNumber);
  if (!orNumber) throw new AppError(400, 'Please enter the OR number from the receipt booklet.');
  if (input.amount.lte(0)) throw new AppError(400, 'Please enter an amount greater than zero.');
  if (input.type === 'OTHER' && !input.description.trim()) {
    throw new AppError(400, 'Please type a short description of what this payment is for.');
  }
  const paymentDate = todayManila();

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { id: input.accountId } });
      if (!account) throw notFound('This account');

      if (await tx.payment.findUnique({ where: { orNumber }, select: { id: true } })) {
        throw await duplicateOrError(tx, orNumber);
      }

      if (input.type === 'SHARE_CAPITAL' && account.membershipStatus === 'NONE') {
        throw new AppError(400, 'Only members can pay share capital. Open this account and click "Make a Member" first.');
      }

      let connectionId: number | null = null;
      let waterBillId: number | null = null;
      let saleId: number | null = null;
      if (input.type === 'RICE_LPG') {
        saleId = (await saleForPayment(tx, account.id, input.saleId ?? null, input.amount)).id;
      }
      if (input.type === 'WATER_BILL') {
        const bill = await billForPayment(tx, account.id, input.waterBillId ?? null, input.amount);
        waterBillId = bill.id;
        connectionId = bill.connectionId;
      }
      if (input.type === 'MEMBERSHIP_FEE') {
        const settings = await getSettings(tx);
        await assertCanPayMembershipFee(tx, account.id, input.amount, new Prisma.Decimal(settings.membership_fee));
      }
      if (input.type === 'INSTALLATION_FEE') {
        // Link the fee to the oldest connection that is waiting for installation and not yet paid for.
        const waiting = await tx.waterConnection.findFirst({
          where: {
            accountId: account.id,
            status: 'PENDING_INSTALLATION',
            payments: { none: { type: 'INSTALLATION_FEE', status: 'ACTIVE' } },
          },
          orderBy: { id: 'asc' },
        });
        connectionId = waiting?.id ?? null;
      }

      const payment = await tx.payment.create({
        data: {
          accountId: account.id,
          type: input.type,
          amount: input.amount,
          orNumber,
          paymentDate: toDbDate(paymentDate),
          connectionId,
          waterBillId,
          saleId,
          description: input.description.trim(),
          createdById: userId,
        },
      });
      await audit(tx, userId, 'payment.create', 'payment', payment.id, null, payment);

      if (input.type === 'MEMBERSHIP_FEE') {
        await completeMembership(tx, account.id, paymentDate, userId);
      }
      if (waterBillId) await refreshBillSettled(tx, waterBillId);
      if (saleId) await refreshSaleSettled(tx, saleId);
      return payment;
    });
  } catch (err) {
    // Two cashiers saving the same OR number at the same moment: the database's unique rule catches it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw await duplicateOrError(prisma, orNumber);
    }
    throw err;
  }
}

/** Voids a payment. The record stays, marked VOID, and keeps its OR number. */
export async function voidPayment(paymentId: number, reason: string, userId: number) {
  if (!reason.trim()) throw new AppError(400, 'Please type the reason for voiding this payment.');
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound('This payment');
    if (payment.status === 'VOID') throw new AppError(400, 'This payment was already voided.');

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'VOID', voidReason: reason.trim(), voidedAt: new Date(), voidedById: userId },
    });
    await audit(tx, userId, 'payment.void', 'payment', paymentId, payment, updated);

    if (payment.type === 'MEMBERSHIP_FEE' && payment.accountId) {
      await revokeMembership(tx, payment.accountId, userId);
    }
    // A cash Rice & LPG sale is voided with its payment; a credit sale goes back to unpaid.
    if (payment.saleId) await onSalePaymentVoided(tx, payment.saleId, reason.trim(), userId);
    // The water bill goes back to unpaid.
    if (payment.waterBillId) await refreshBillSettled(tx, payment.waterBillId);
    return updated;
  });
}

export interface OwedItem {
  type: PaymentType;
  label: string;
  amount: string;
  waterBillId?: number;
  saleId?: number;
  status?: string;
}

/** What the account still owes, shown on the Cashier screen. Water bills and loans join in 1B/1C. */
export async function getOwed(accountId: number): Promise<OwedItem[]> {
  const [account, settings, bills, creditSales, unpaidInstallations] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId } }),
    getSettings(prisma),
    unpaidBills(prisma, { connection: { accountId } }),
    unpaidCreditSales(prisma, accountId),
    prisma.waterConnection.findMany({
      where: {
        accountId,
        status: 'PENDING_INSTALLATION',
        payments: { none: { type: 'INSTALLATION_FEE', status: 'ACTIVE' } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  if (!account) throw notFound('This account');
  const owed: OwedItem[] = [];
  const severalConnections = new Set(bills.map((b) => b.connectionId)).size > 1;
  for (const bill of bills) {
    const state = billState(bill, bill.payments);
    const meter = severalConnections && bill.connection.meterSerial ? `, water meter ${bill.connection.meterSerial}` : '';
    const penalty = state.penalty.gt(0) ? ', with late penalty' : '';
    owed.push({
      type: 'WATER_BILL',
      label: `Water Bill for ${periodLabel(bill.period)}${meter}${penalty}`,
      amount: state.balance.toFixed(2),
      waterBillId: bill.id,
      status: state.status,
    });
  }
  for (const c of unpaidInstallations) {
    owed.push({
      type: 'INSTALLATION_FEE',
      label: c.meterSerial ? `Installation Fee (water meter ${c.meterSerial})` : 'Installation Fee',
      amount: new Prisma.Decimal(settings.installation_fee).toFixed(2),
    });
  }
  for (const { sale, balance } of creditSales) {
    owed.push({
      type: 'RICE_LPG',
      label: `Rice & LPG on credit, ${formatDate(fromDbDate(sale.saleDate)!)} (${itemsSummary(sale.items)})`,
      amount: balance.toFixed(2),
      saleId: sale.id,
    });
  }
  if (account.membershipStatus === 'PENDING') {
    owed.push({
      type: 'MEMBERSHIP_FEE',
      label: 'Membership Fee',
      amount: new Prisma.Decimal(settings.membership_fee).toFixed(2),
    });
  }
  return owed;
}
