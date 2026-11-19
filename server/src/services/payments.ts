import { Prisma, type PaymentType } from '@prisma/client';
import { LONG_TX, prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { formatDate, fromDbDate, toDbDate, todayManila } from '../lib/dates';
import { audit } from './audit';
import { getSettings } from './settings';
import { assertCanPayMembershipFee, completeMembership, revokeMembership } from './membership';
import { periodLabel } from '../lib/periods';
import { billForPayment, billState, refreshBillSettled, unpaidBills } from './water';
import { itemsSummary, onSalePaymentVoided, refreshSaleSettled, saleForPayment, unpaidCreditSales } from './sales';
import { loanOwed, refreshLoanPaid } from './loans';

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

/**
 * Adds one payment inside an open transaction (used by createInvoice). `orKey` is the unique value
 * kept in the payment's number column: the invoice number for the first payment of an invoice, and
 * "number#2", "number#3"... for the others.
 */
export async function addPayment(
  tx: Prisma.TransactionClient,
  input: Omit<NewPayment, 'orNumber'>,
  userId: number,
  opts: { orKey: string; invoiceId: number; paymentDate: string },
) {
  if (input.amount.lte(0)) throw new AppError(400, 'Please enter an amount greater than zero.');
  if (input.type === 'OTHER' && !input.description.trim()) {
    throw new AppError(400, 'Please type a short description of what this payment is for.');
  }
  const account = await tx.account.findUnique({ where: { id: input.accountId } });
  if (!account) throw notFound('This account');

  // Share capital is for members, and for applicants the Admin has approved (not before approval).
  if (input.type === 'SHARE_CAPITAL' && account.membershipStatus !== 'MEMBER' && account.membershipStatus !== 'PENDING') {
    throw new AppError(400, 'Only members, and applicants approved by the Admin, can pay share capital.');
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
      orNumber: opts.orKey,
      invoiceId: opts.invoiceId,
      paymentDate: toDbDate(opts.paymentDate),
      connectionId,
      waterBillId,
      saleId,
      description: input.description.trim(),
      createdById: userId,
    },
  });
  await audit(tx, userId, 'payment.create', 'payment', payment.id, null, payment);

  if (input.type === 'MEMBERSHIP_FEE') {
    await completeMembership(tx, account.id, opts.paymentDate, userId);
  }
  if (waterBillId) await refreshBillSettled(tx, waterBillId);
  if (saleId) await refreshSaleSettled(tx, saleId);
  return payment;
}

/** Voids a payment. The record stays, marked VOID, and keeps its OR number. */
/**
 * Voids a payment. A payment written on an invoice cancels the whole invoice: every payment on it is
 * voided and the invoice number is marked CANCELLED (it is never used again).
 */
export async function voidPayment(paymentId: number, reason: string, userId: number) {
  if (!reason.trim()) throw new AppError(400, 'Please type the reason for voiding this payment.');
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound('This payment');
    if (payment.status === 'VOID') throw new AppError(400, 'This payment was already voided.');
    if (payment.invoiceId) {
      await cancelInvoiceTx(tx, payment.invoiceId, reason, userId);
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    }
    return voidOne(tx, payment.id, reason, userId);
  }, LONG_TX);
}

/** Cancels an invoice: voids each of its payments (and a charge invoice's credit sale). */
export async function cancelInvoiceTx(tx: Prisma.TransactionClient, invoiceId: number, reason: string, userId: number) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
  if (!invoice) throw notFound('This invoice');
  if (invoice.status === 'VOID') throw new AppError(400, `Invoice No. ${invoice.number} was already cancelled.`);
  for (const p of invoice.payments.filter((x) => x.status === 'ACTIVE')) await voidOne(tx, p.id, reason, userId);
  if (invoice.saleType === 'CHARGE' && invoice.saleId) {
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: invoice.saleId } });
    if (sale.status === 'ACTIVE') {
      await tx.sale.update({ where: { id: sale.id }, data: { status: 'VOID', voidReason: reason.trim(), voidedAt: new Date(), voidedById: userId } });
    }
  }
  const updated = await tx.invoice.update({
    where: { id: invoiceId },
    data: { status: 'VOID', cancelReason: reason.trim(), cancelledAt: new Date(), cancelledById: userId },
  });
  await audit(tx, userId, 'invoice.cancel', 'invoice', invoiceId, invoice, updated);
  return updated;
}

async function voidOne(tx: Prisma.TransactionClient, paymentId: number, reason: string, userId: number) {
  {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
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
    // The loan's split no longer counts; a paid loan may be owing again.
    if (payment.loanId) await refreshLoanPaid(tx, payment.loanId);
    return updated;
  }
}

export interface OwedItem {
  type: PaymentType;
  label: string;
  amount: string;
  waterBillId?: number;
  saleId?: number;
  status?: string;
  /** Loans: the loan, and the amount to pay it off today. */
  loanId?: number;
  payoffAmount?: string;
  balance?: string;
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
  for (const loan of await loanOwed(prisma, accountId)) owed.push(loan);
  if (account.membershipStatus === 'PENDING') {
    owed.push({
      type: 'MEMBERSHIP_FEE',
      label: 'Membership Fee',
      amount: new Prisma.Decimal(settings.membership_fee).toFixed(2),
    });
  }
  return owed;
}
