import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { isDateString, todayManila } from '../lib/dates';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { isPeriod, periodLabel, periodOf } from '../lib/periods';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { RATE_CLASSES, RATE_CLASS_LABEL, termsOf, type RateClass, type Tier } from '../services/rates';
import { getSettings } from '../services/settings';
import { billJson, billState, saveReadings, unpaidBills } from '../services/water';

export const waterRouter = Router();

function scheduleJson(s: Prisma.RateScheduleGetPayload<object> & { _count?: { bills: number } }) {
  const terms = termsOf(s);
  return {
    id: s.id,
    rateClass: s.rateClass,
    effectiveFrom: s.effectiveFrom,
    minimumCharge: s.minimumCharge.toFixed(2),
    minimumCoversM3: terms.minimumCoversM3,
    tiers: terms.tiers,
    method: terms.method,
    note: s.note,
    billCount: s._count?.bills,
  };
}

// ---- Monthly meter reading ----------------------------------------------------------------

// The reading sheet for one month: every active connection with its previous reading.
waterRouter.get(
  '/readings',
  wrap(async (req, res) => {
    const period = typeof req.query.period === 'string' && req.query.period ? req.query.period : periodOf(todayManila());
    if (!isPeriod(period)) throw new AppError(400, 'Please choose a valid month.');
    const areaId = Number(req.query.areaId) || null;

    const [connections, schedules, areas] = await Promise.all([
      prisma.waterConnection.findMany({
        where: {
          account: areaId ? { areaId } : undefined,
          OR: [{ status: 'ACTIVE' }, { readings: { some: { period } } }],
        },
        include: {
          account: { include: { area: true } },
          readings: { orderBy: { period: 'desc' }, take: 6, include: { bill: { include: { payments: true } } } },
        },
      }),
      prisma.rateSchedule.findMany({ where: { effectiveFrom: { lte: period } }, orderBy: { effectiveFrom: 'desc' } }),
      prisma.area.findMany({ orderBy: { id: 'asc' } }),
    ]);

    const rows = connections
      .map((c) => {
        const existing = c.readings.find((r) => r.period === period) ?? null;
        const earlier = c.readings.filter((r) => r.period < period);
        const hasLater = c.readings.some((r) => r.period > period);
        const paid = existing?.bill?.payments.some((p) => p.status === 'ACTIVE') ?? false;
        const usage = earlier.slice(0, 3).map((r) => Math.max(0, r.currentReading - r.previousReading));
        return {
          connectionId: c.id,
          accountId: c.accountId,
          name: c.account.fullName,
          area: c.account.area.name,
          areaId: c.account.areaId,
          meter: [c.meterName, c.meterSerial && `# ${c.meterSerial}`].filter(Boolean).join(' '),
          rateClass: c.rateClass,
          previousReading: existing?.previousReading ?? earlier[0]?.currentReading ?? c.initialReading,
          currentReading: existing?.currentReading ?? null,
          usualUsage: usage.length ? Math.round(usage.reduce((a, b) => a + b, 0) / usage.length) : null,
          // Why the reading can no longer be changed, if it can't.
          locked: paid ? 'Already paid' : hasLater ? 'A later month was read' : null,
        };
      })
      .sort((a, b) => a.areaId - b.areaId || a.name.localeCompare(b.name));

    const rates: Record<string, ReturnType<typeof scheduleJson> | null> = {};
    for (const rateClass of RATE_CLASSES) {
      const s = schedules.find((x) => x.rateClass === rateClass);
      rates[rateClass] = s ? scheduleJson(s) : null;
    }
    const settings = await getSettings(prisma);
    res.json({ period, today: todayManila(), rows, rates, areas, dueDays: Number(settings.water_due_days) });
  }),
);

const readingsSchema = z.object({
  period: z.string().refine(isPeriod, 'Please choose a valid month.'),
  readDate: z.string().refine(isDateString, 'Please choose the reading date.'),
  readings: z
    .array(
      z.object({
        connectionId: z.number().int().positive(),
        currentReading: z
          .number({ invalid_type_error: 'A reading must be a whole number.' })
          .int('A reading must be a whole number.')
          .min(0, 'A reading cannot be below zero.')
          .max(99_999_999, 'A reading is too large.'),
      }),
    )
    .max(2000),
});

waterRouter.post(
  '/readings',
  allow('ADMIN', 'STAFF'),
  wrap(async (req, res) => {
    const { period, readDate, readings } = readingsSchema.parse(req.body);
    if (readDate > todayManila()) throw new AppError(400, 'The reading date cannot be in the future.');
    res.json(await saveReadings(period, readDate, readings, req.user!.id));
  }),
);

// ---- Overdue list and disconnection candidates --------------------------------------------

waterRouter.get(
  '/overdue',
  wrap(async (req, res) => {
    const areaId = Number(req.query.areaId) || null;
    const [bills, settings, areas] = await Promise.all([
      unpaidBills(prisma, areaId ? { connection: { account: { areaId } } } : {}),
      getSettings(prisma),
      prisma.area.findMany({ orderBy: { id: 'asc' } }),
    ]);
    const threshold = Math.max(1, parseInt(settings.water_disconnect_months, 10) || 1);
    const today = todayManila();

    const byAccount = new Map<number, { accountId: number; name: string; accountNumber: string; area: string; phone: string; periods: string[]; amount: Prisma.Decimal }>();
    for (const bill of bills) {
      const state = billState(bill, bill.payments, today);
      if (state.status !== 'OVERDUE') continue;
      const a = bill.connection.account;
      const entry = byAccount.get(a.id) ?? {
        accountId: a.id,
        name: a.fullName,
        accountNumber: a.accountNumber,
        area: a.area.name,
        phone: a.phone,
        periods: [],
        amount: new Prisma.Decimal(0),
      };
      if (!entry.periods.includes(bill.period)) entry.periods.push(bill.period);
      entry.amount = entry.amount.plus(state.balance);
      byAccount.set(a.id, entry);
    }
    const rows = [...byAccount.values()]
      .map((r) => ({
        ...r,
        amount: r.amount.toFixed(2),
        months: r.periods.length,
        // Unpaid for the number of months set in Settings or more. Disconnecting stays a manual decision.
        disconnectionCandidate: r.periods.length >= threshold,
      }))
      .sort((a, b) => b.months - a.months || a.area.localeCompare(b.area) || a.name.localeCompare(b.name));

    res.json({
      today,
      threshold,
      areas,
      rows,
      total: rows.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0)).toFixed(2),
      coop: { name: settings.coop_name, address: settings.coop_address, cdaNo: settings.coop_cda_no },
    });
  }),
);

// ---- One water bill, for the printable bill / notice --------------------------------------

waterRouter.get(
  '/bills/:id',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This water bill');
    const bill = await prisma.waterBill.findUnique({
      where: { id },
      include: { payments: true, reading: true, rateSchedule: true, connection: { include: { account: { include: { area: true } } } } },
    });
    if (!bill) throw notFound('This water bill');
    const [earlier, settings] = await Promise.all([
      unpaidBills(prisma, { connectionId: bill.connectionId, period: { lt: bill.period } }),
      getSettings(prisma),
    ]);
    const previous = earlier.map((b) => ({ period: b.period, balance: billState(b, b.payments).balance }));
    const previousBalance = previous.reduce((sum, b) => sum.plus(b.balance), new Prisma.Decimal(0));
    const json = billJson(bill);
    const a = bill.connection.account;
    res.json({
      bill: json,
      account: { id: a.id, name: a.fullName, accountNumber: a.accountNumber, address: bill.connection.address || a.address, area: a.area.name },
      meter: [bill.connection.meterName, bill.connection.meterSerial && `# ${bill.connection.meterSerial}`].filter(Boolean).join(' '),
      rateClass: bill.connection.rateClass,
      penaltyIfLate: bill.penaltyAmount.toFixed(2),
      previousBalance: previousBalance.toFixed(2),
      previousMonths: previous.map((b) => periodLabel(b.period)),
      totalDue: previousBalance.plus(json.balance).toFixed(2),
      coop: { name: settings.coop_name, address: settings.coop_address, cdaNo: settings.coop_cda_no },
    });
  }),
);

// ---- Water rates ---------------------------------------------------------------------------

waterRouter.get(
  '/rates',
  wrap(async (_req, res) => {
    const thisMonth = periodOf(todayManila());
    const all = await prisma.rateSchedule.findMany({
      orderBy: { effectiveFrom: 'desc' },
      include: { _count: { select: { bills: true } } },
    });
    res.json({
      thisMonth,
      classes: RATE_CLASSES.map((rateClass) => {
        const versions = all.filter((s) => s.rateClass === rateClass).map(scheduleJson);
        return {
          rateClass,
          label: RATE_CLASS_LABEL[rateClass],
          current: versions.find((v) => v.effectiveFrom <= thisMonth) ?? null,
          versions,
        };
      }),
    });
  }),
);

const moneyField = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const parsed = parseMoney(String(v));
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: `Please enter a valid amount for the ${label}.` });
      return z.NEVER;
    }
    return parsed.toFixed(2);
  });

const rateSchema = z.object({
  rateClass: z.enum(['RESIDENTIAL', 'COMMERCIAL'], { errorMap: () => ({ message: 'Please choose the rate class.' }) }),
  effectiveFrom: z.string().refine(isPeriod, 'Please choose the month the new rates start.'),
  minimumCharge: moneyField('minimum charge'),
  minimumCoversM3: z.coerce
    .number({ invalid_type_error: 'Please enter how many cu.m the minimum charge covers.' })
    .int('Please enter a whole number of cu.m for the minimum charge.')
    .min(0)
    .max(100000),
  tiers: z
    .array(
      z.object({
        upTo: z.union([z.coerce.number().int().positive(), z.null()]),
        rate: moneyField('price per cu.m'),
      }),
    )
    .min(1, 'Please add at least one price per cu.m.')
    .max(12),
  method: z.enum(['BLOCK', 'PROGRESSIVE']).default('BLOCK'),
  note: z.string().trim().max(200).default(''),
});

// Changing the rates always adds a new version. Bills already made keep the amounts they were made with.
waterRouter.post(
  '/rates',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const data = rateSchema.parse(req.body);
    const tiers = data.tiers as Tier[];

    let last = data.minimumCoversM3;
    tiers.forEach((tier, i) => {
      const isLast = i === tiers.length - 1;
      if (isLast) {
        if (tier.upTo !== null) throw new AppError(400, 'The last block must have no upper limit (leave "up to" blank).');
      } else if (tier.upTo === null || tier.upTo <= last) {
        throw new AppError(400, 'Each block must end at a higher cu.m than the one before it.');
      } else last = tier.upTo;
    });

    const same = await prisma.rateSchedule.findUnique({
      where: { rateClass_effectiveFrom: { rateClass: data.rateClass, effectiveFrom: data.effectiveFrom } },
      include: { _count: { select: { bills: true } } },
    });
    if (same && same._count.bills > 0) {
      throw new AppError(
        409,
        `Bills were already made with the ${RATE_CLASS_LABEL[data.rateClass as RateClass]} rates that start in ${periodLabel(data.effectiveFrom)}. Please choose a later starting month.`,
      );
    }
    const billed = await prisma.waterBill.findFirst({
      where: { period: { gte: data.effectiveFrom }, connection: { rateClass: data.rateClass } },
      orderBy: { period: 'desc' },
    });
    if (billed) {
      throw new AppError(
        409,
        `Bills were already made up to ${periodLabel(billed.period)}. New rates must start in a later month so those bills stay as they are.`,
      );
    }

    const values = {
      minimumCharge: data.minimumCharge,
      minimumCoversM3: data.minimumCoversM3,
      tiers: tiers as unknown as Prisma.InputJsonValue,
      method: data.method,
      note: data.note,
    };
    const saved = same
      ? await prisma.rateSchedule.update({ where: { id: same.id }, data: values })
      : await prisma.rateSchedule.create({
          data: { ...values, rateClass: data.rateClass, effectiveFrom: data.effectiveFrom, createdById: req.user!.id },
        });
    await audit(prisma, req.user!.id, same ? 'rates.replace' : 'rates.create', 'rate_schedule', saved.id, same, saved);
    res.status(201).json(scheduleJson(saved));
  }),
);

