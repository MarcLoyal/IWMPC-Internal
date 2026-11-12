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

export const reportsRouter = Router();

// Home screen summary cards.
reportsRouter.get(
  '/home',
  wrap(async (_req, res) => {
    const today = todayManila();
    const [collections, members, nonMembers] = await Promise.all([
      prisma.payment.aggregate({
        where: { paymentDate: toDbDate(today), status: 'ACTIVE' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.account.count({ where: { isMember: true } }),
      prisma.account.count({ where: { isMember: false } }),
    ]);
    res.json({
      today,
      collections: {
        total: (collections._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: collections._count,
      },
      accounts: { total: members + nonMembers, members, nonMembers },
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

    res.json({
      date,
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
