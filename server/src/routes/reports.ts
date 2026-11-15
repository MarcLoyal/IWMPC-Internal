import { Router } from 'express';
import { Prisma, type PaymentType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { isDateString, toDbDate, todayManila } from '../lib/dates';
import { PAYMENT_TYPE_LABEL } from '../lib/labels';
import { findOrGaps } from '../lib/orNumbers';
import { paymentJson } from '../lib/serialize';
import { wrap } from '../middleware/auth';
import { getSettings } from '../services/settings';
import { billState, unpaidBills } from '../services/water';

export const reportsRouter = Router();

// Home screen summary cards.
reportsRouter.get(
  '/home',
  wrap(async (_req, res) => {
    const today = todayManila();
    const [collections, members, nonMembers, unpaid] = await Promise.all([
      prisma.payment.aggregate({
        where: { paymentDate: toDbDate(today), status: 'ACTIVE' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.account.count({ where: { isMember: true } }),
      prisma.account.count({ where: { isMember: false } }),
      unpaidBills(prisma),
    ]);
    const overdueAccounts = new Set<number>();
    let overdueTotal = new Prisma.Decimal(0);
    for (const bill of unpaid) {
      const state = billState(bill, bill.payments, today);
      if (state.status !== 'OVERDUE') continue;
      overdueAccounts.add(bill.connection.accountId);
      overdueTotal = overdueTotal.plus(state.balance);
    }
    res.json({
      today,
      collections: {
        total: (collections._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: collections._count,
      },
      accounts: { total: members + nonMembers, members, nonMembers },
      overdueWater: { count: overdueAccounts.size, total: overdueTotal.toFixed(2) },
    });
  }),
);

// Daily Collection Report: every payment of the day, totals per type, grand total, OR gaps.
reportsRouter.get(
  '/daily',
  wrap(async (req, res) => {
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : todayManila();
    if (!isDateString(date)) throw new AppError(400, 'Please choose a valid date.');

    const [payments, settings] = await Promise.all([
      prisma.payment.findMany({
        where: { paymentDate: toDbDate(date) },
        include: {
          account: { select: { id: true, fullName: true, accountNumber: true } },
          waterBill: { select: { period: true } },
          sale: { include: { items: true } },
          createdBy: { select: { name: true } },
          voidedBy: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      }),
      getSettings(prisma),
    ]);

    // Voided payments are listed but never counted.
    const active = payments.filter((p) => p.status === 'ACTIVE');
    const zero = new Prisma.Decimal(0);
    const byType = new Map<PaymentType, { count: number; total: Prisma.Decimal }>();
    for (const p of active) {
      const entry = byType.get(p.type) ?? { count: 0, total: zero };
      byType.set(p.type, { count: entry.count + 1, total: entry.total.plus(p.amount) });
    }

    // Rice & LPG sold and paid for today, per product and unit. Money collected today for an
    // earlier credit sale is shown on its own line (the goods were counted on the day of sale).
    const sold = new Map<string, { product: string; unit: string; quantity: Prisma.Decimal; amount: Prisma.Decimal }>();
    let creditCollected = zero;
    for (const p of active) {
      if (p.type !== 'RICE_LPG' || !p.sale) continue;
      if (p.sale.isCredit) {
        creditCollected = creditCollected.plus(p.amount);
        continue;
      }
      for (const item of p.sale.items) {
        const key = `${item.productName}|${item.unitLabel}`;
        const line = sold.get(key) ?? { product: item.productName, unit: item.unitLabel, quantity: zero, amount: zero };
        sold.set(key, { ...line, quantity: line.quantity.plus(item.quantity), amount: line.amount.plus(item.amount) });
      }
    }

    res.json({
      date,
      riceLpg: {
        lines: [...sold.values()].map((l) => ({
          product: l.product,
          unit: l.unit,
          quantity: l.quantity.toDecimalPlaces(2).toString(),
          amount: l.amount.toFixed(2),
        })),
        creditCollected: creditCollected.toFixed(2),
      },
      coop: { name: settings.coop_name, address: settings.coop_address, cdaNo: settings.coop_cda_no },
      payments: payments.map(paymentJson),
      totals: (Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[])
        .filter((t) => byType.has(t))
        .map((t) => ({ type: t, count: byType.get(t)!.count, total: byType.get(t)!.total.toFixed(2) })),
      grandTotal: active.reduce((sum, p) => sum.plus(p.amount), zero).toFixed(2),
      count: active.length,
      voidedCount: payments.length - active.length,
      // Voided ORs still count as "used" in the booklet, so they don't create gaps.
      orGaps: findOrGaps(payments.map((p) => p.orNumber)),
    });
  }),
);
