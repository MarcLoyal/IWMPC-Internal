import { Prisma, type Payment, type WaterBill } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { fromDbDate, toDbDate, todayManila } from '../lib/dates';
import { daysBetween, dueDateFor, periodLabel } from '../lib/periods';
import { audit } from './audit';
import { displayNumber } from '../lib/orNumbers';
import { computeWaterCharge, scheduleFor, termsOf } from './rates';
import { getSettings } from './settings';

export type BillStatus = 'PAID' | 'UNPAID' | 'DUE_SOON' | 'OVERDUE';

export const DUE_SOON_DAYS = 5;

type BillPayment = Pick<Payment, 'amount' | 'paymentDate' | 'status' | 'orNumber'>;

export interface BillState {
  /** The late penalty, if it applies (0 while the bill is on time). */
  penalty: Prisma.Decimal;
  paid: Prisma.Decimal;
  /** What is still owed, penalty included. */
  balance: Prisma.Decimal;
  status: BillStatus;
  datePaid: string | null;
  orNumbers: string[];
}

/**
 * Works out where a bill stands today. Voided payments never count.
 * The penalty applies once the due date has passed without the bill amount being paid in full
 * on or before the due date. It then stays, even if the bill is paid later.
 */
export function billState(
  bill: Pick<WaterBill, 'amount' | 'penaltyAmount' | 'dueDate'>,
  payments: BillPayment[],
  today: string = todayManila(),
): BillState {
  const due = fromDbDate(bill.dueDate)!;
  const active = payments.filter((p) => p.status === 'ACTIVE');
  const zero = new Prisma.Decimal(0);
  const paid = active.reduce((sum, p) => sum.plus(p.amount), zero);
  const paidOnTime = active.filter((p) => fromDbDate(p.paymentDate)! <= due).reduce((sum, p) => sum.plus(p.amount), zero);

  const late = today > due && paidOnTime.lt(bill.amount);
  const penalty = late ? bill.penaltyAmount : zero;
  const balance = Prisma.Decimal.max(zero, bill.amount.plus(penalty).minus(paid));

  let status: BillStatus;
  if (balance.isZero()) status = 'PAID';
  else if (today > due) status = 'OVERDUE';
  else if (daysBetween(today, due) <= DUE_SOON_DAYS) status = 'DUE_SOON';
  else status = 'UNPAID';

  const dates = active.map((p) => fromDbDate(p.paymentDate)!).sort();
  return {
    penalty,
    paid,
    balance,
    status,
    datePaid: balance.isZero() && dates.length ? dates[dates.length - 1] : null,
    orNumbers: [...new Set(active.map((p) => displayNumber(p.orNumber)))],
  };
}

/** Call after any payment on a bill is saved or voided. */
export async function refreshBillSettled(tx: Prisma.TransactionClient, billId: number) {
  const bill = await tx.waterBill.findUniqueOrThrow({ where: { id: billId }, include: { payments: true } });
  const state = billState(bill, bill.payments);
  await tx.waterBill.update({
    where: { id: billId },
    data: { settledOn: state.status === 'PAID' ? toDbDate(state.datePaid ?? todayManila()) : null },
  });
}

/** The late penalty a new bill will carry, from the current settings. */
function penaltyFor(amount: Prisma.Decimal, type: string, value: string): Prisma.Decimal {
  const v = new Prisma.Decimal(value || '0');
  return (type === 'FIXED' ? v : amount.times(v).dividedBy(100)).toDecimalPlaces(2);
}

export interface ReadingInput {
  connectionId: number;
  currentReading: number;
}

export interface ReadingResult {
  saved: number;
  unchanged: number;
  problems: string[];
}

/**
 * Saves a month's meter readings and creates (or corrects) the water bill for each.
 * A reading can be corrected only while it is the latest one for that connection and its bill
 * has no payments yet.
 */
export async function saveReadings(
  period: string,
  readDate: string,
  inputs: ReadingInput[],
  userId: number,
): Promise<ReadingResult> {
  const settings = await getSettings(prisma);
  const dueDays = Math.max(0, parseInt(settings.water_due_days, 10) || 0);
  const result: ReadingResult = { saved: 0, unchanged: 0, problems: [] };

  for (const input of inputs) {
    await prisma.$transaction(async (tx) => {
      const connection = await tx.waterConnection.findUnique({
        where: { id: input.connectionId },
        include: { account: { select: { fullName: true } } },
      });
      if (!connection) throw notFound('This connection');
      const who = connection.account.fullName;

      const existing = await tx.meterReading.findUnique({
        where: { connectionId_period: { connectionId: connection.id, period } },
        include: { bill: { include: { payments: true } } },
      });
      if (existing && existing.currentReading === input.currentReading) {
        result.unchanged += 1;
        return;
      }
      const later = await tx.meterReading.findFirst({
        where: { connectionId: connection.id, period: { gt: period } },
        orderBy: { period: 'desc' },
      });
      if (later) {
        result.problems.push(`${who}: already has a reading for ${periodLabel(later.period)}, so ${periodLabel(period)} cannot be changed.`);
        return;
      }
      if (existing?.bill?.payments.some((p) => p.status === 'ACTIVE')) {
        result.problems.push(`${who}: the ${periodLabel(period)} bill already has a payment, so the reading cannot be changed.`);
        return;
      }
      if (!existing && connection.status !== 'ACTIVE') {
        result.problems.push(`${who}: this connection is not active.`);
        return;
      }

      const before = await tx.meterReading.findFirst({
        where: { connectionId: connection.id, period: { lt: period } },
        orderBy: { period: 'desc' },
      });
      const previousReading = before?.currentReading ?? connection.initialReading;
      // A reading lower than the last one (e.g. a replaced meter) is allowed; it bills as no use.
      const cubicMeters = Math.max(0, input.currentReading - previousReading);
      const schedule = await scheduleFor(tx, connection.rateClass, period);
      const amount = computeWaterCharge(cubicMeters, termsOf(schedule));
      const bill = {
        cubicMeters,
        amount,
        penaltyAmount: penaltyFor(amount, settings.water_penalty_type, settings.water_penalty_value),
        billDate: toDbDate(readDate),
        dueDate: toDbDate(dueDateFor(period, readDate, settings.water_due_rule, parseInt(settings.water_due_day, 10) || 15, dueDays)),
        rateScheduleId: schedule.id,
      };
      const reading = { previousReading, currentReading: input.currentReading, readDate: toDbDate(readDate), enteredById: userId };

      if (existing) {
        await tx.meterReading.update({ where: { id: existing.id }, data: reading });
        const updated = await tx.waterBill.update({ where: { readingId: existing.id }, data: bill });
        await audit(tx, userId, 'reading.correct', 'water_bill', updated.id, existing, { ...reading, ...bill });
      } else {
        const created = await tx.meterReading.create({ data: { ...reading, connectionId: connection.id, period } });
        const newBill = await tx.waterBill.create({
          data: { ...bill, connectionId: connection.id, readingId: created.id, period },
        });
        await audit(tx, userId, 'reading.create', 'water_bill', newBill.id, null, { ...reading, ...bill, period });
      }
      result.saved += 1;
    });
  }
  return result;
}

const billInclude = {
  payments: { select: { amount: true, paymentDate: true, status: true, orNumber: true } },
  reading: true,
  connection: { include: { account: { include: { area: true } } } },
} as const;

export type BillWithAll = Prisma.WaterBillGetPayload<{ include: typeof billInclude }>;

export function billJson(bill: Prisma.WaterBillGetPayload<{ include: { payments: true; reading: true } }> | BillWithAll, today = todayManila()) {
  const state = billState(bill, bill.payments, today);
  return {
    id: bill.id,
    connectionId: bill.connectionId,
    period: bill.period,
    readDate: fromDbDate(bill.reading.readDate)!,
    previousReading: bill.reading.previousReading,
    currentReading: bill.reading.currentReading,
    cubicMeters: bill.cubicMeters,
    amount: bill.amount.toFixed(2),
    penalty: state.penalty.toFixed(2),
    paid: state.paid.toFixed(2),
    balance: state.balance.toFixed(2),
    dueDate: fromDbDate(bill.dueDate)!,
    status: state.status,
    datePaid: state.datePaid,
    orNumbers: state.orNumbers,
  };
}

/** Every bill that still has something owed, oldest first. */
export async function unpaidBills(db: Db, where: Prisma.WaterBillWhereInput = {}) {
  return db.waterBill.findMany({
    where: { settledOn: null, ...where },
    include: billInclude,
    orderBy: [{ period: 'asc' }, { id: 'asc' }],
  });
}

/** Checks a water bill payment and returns the bill it pays. */
export async function billForPayment(
  tx: Prisma.TransactionClient,
  accountId: number,
  waterBillId: number | null,
  amount: Prisma.Decimal,
) {
  // No bill chosen: pay the oldest unpaid one.
  const bill = waterBillId
    ? await tx.waterBill.findUnique({ where: { id: waterBillId }, include: { payments: true, connection: true } })
    : await tx.waterBill.findFirst({
        where: { settledOn: null, connection: { accountId } },
        include: { payments: true, connection: true },
        orderBy: [{ period: 'asc' }, { id: 'asc' }],
      });
  if (!bill || bill.connection.accountId !== accountId) {
    throw new AppError(400, waterBillId ? 'This water bill was not found on this account.' : 'This account has no unpaid water bill.');
  }
  const state = billState(bill, bill.payments);
  if (state.status === 'PAID') throw new AppError(400, `The ${periodLabel(bill.period)} water bill is already paid.`);
  if (amount.gt(state.balance)) {
    throw new AppError(
      400,
      `The amount is more than what is owed for ${periodLabel(bill.period)} (₱${state.balance.toFixed(2)}). Please record each month's bill as its own payment.`,
    );
  }
  return bill;
}
