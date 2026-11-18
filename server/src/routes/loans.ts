import { Router } from 'express';
import { Prisma, type LoanStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { addDays } from '../lib/periods';
import { todayManila } from '../lib/dates';
import { allow, allowWork, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import type { PayoffRule } from '../services/loanMath';
import {
  DUE_SOON_DAYS,
  applyForLoan,
  approveLoan,
  borrowLimit,
  cancelLoan,
  limitJson,
  loanInclude,
  loanJson,
  loanTypeJson,
  quote,
  quoteJson,
  rejectLoan,
  releaseLoan,
  setOpeningShareCapital,
  splitFor,
  summaryOf,
  type FullLoan,
} from '../services/loans';
import { unpaid } from '../services/loanMath';

export const loansRouter = Router();

const money = (what: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const parsed = parseMoney(String(v));
    if (!parsed || parsed.lt(0)) {
      ctx.addIssue({ code: 'custom', message: `Please enter a valid amount for ${what}, for example 3000.00.` });
      return z.NEVER;
    }
    return parsed;
  });
const percent = (what: string) =>
  z.coerce.number({ invalid_type_error: `Please enter a number for ${what}.` }).min(0, `${what} cannot be below zero.`).max(100, `${what} must be 100 or less.`);
const reason = (what: string) => z.string({ required_error: `Please type the reason for ${what}.` }).trim().min(1, `Please type the reason for ${what}.`).max(300);

const requestSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  loanTypeId: z.coerce.number({ invalid_type_error: 'Please choose a loan type.' }).int().positive('Please choose a loan type.'),
  amount: money('the loan'),
  months: z.coerce.number({ invalid_type_error: 'Please choose the number of months.' }).int('Please choose a whole number of months.'),
  purpose: z.string().trim().max(200).default(''),
  overLimitReason: z.string().trim().max(300).optional(),
});

/** A short row for lists and Home. */
function row(loan: FullLoan, today = todayManila()) {
  const s = summaryOf(loan, today);
  return {
    id: loan.id,
    number: loan.number,
    status: loan.status,
    standing: s.standing,
    account: { id: loan.account.id, fullName: loan.account.fullName, accountNumber: loan.account.accountNumber, area: loan.account.area.name, areaId: loan.account.areaId },
    typeName: loan.typeName,
    principal: loan.principal.toFixed(2),
    monthlyPayment: loan.monthlyPayment.toFixed(2),
    months: loan.months,
    balance: s.balance.toFixed(2),
    next: s.next ? { no: s.next.no, dueDate: s.next.dueDate, amount: s.next.amount.toFixed(2) } : null,
    overdueAmount: s.overdueAmount.toFixed(2),
    overdueCount: s.overdueCount,
    oldestOverdue: s.states.find((x) => x.dueDate < today && unpaid.principal(x).plus(unpaid.interest(x)).plus(unpaid.penalty(x)).gt(0))?.dueDate ?? null,
    createdAt: loan.createdAt.toISOString(),
    releaseDate: loan.releaseDate?.toISOString().slice(0, 10) ?? null,
    phone: loan.account.phone,
  };
}

/** Owed on installments due from `from` to `to` (inclusive) that are not yet paid. */
function dueBetween(loan: FullLoan, from: string, to: string, today = todayManila()) {
  const s = summaryOf(loan, today);
  return s.states
    .filter((x) => x.dueDate >= from && x.dueDate <= to)
    .reduce((sum, x) => sum.plus(unpaid.penalty(x)).plus(unpaid.interest(x)).plus(unpaid.principal(x)), new Prisma.Decimal(0));
}

// ---- Lists and Home -------------------------------------------------------------------------------

const STATUSES = ['FOR_APPROVAL', 'APPROVED', 'RELEASED', 'PAID', 'REJECTED', 'CANCELLED'] as const;

loansRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = z
      .object({
        status: z.enum(STATUSES).optional().or(z.literal('').transform(() => undefined)),
        loanTypeId: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
        areaId: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
        due: z.enum(['WEEK', 'OVERDUE']).optional().or(z.literal('').transform(() => undefined)),
        accountId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const loans = await prisma.loan.findMany({
      where: {
        ...(q.due ? { status: 'RELEASED' as LoanStatus } : q.status ? { status: q.status } : {}),
        ...(q.loanTypeId ? { loanTypeId: q.loanTypeId } : {}),
        ...(q.areaId ? { account: { areaId: q.areaId } } : {}),
        ...(q.accountId ? { accountId: q.accountId } : {}),
      },
      include: { ...loanInclude, account: { include: { area: true } } },
      orderBy: { id: 'desc' },
      take: 1000,
    });
    const today = todayManila();
    const weekEnd = addDays(today, DUE_SOON_DAYS - 1);
    let rows = loans.map((l) => ({ ...row(l, today), dueThisWeek: dueBetween(l, today, weekEnd, today).toFixed(2) }));
    if (q.due === 'OVERDUE') rows = rows.filter((r) => r.overdueCount > 0).sort((a, b) => a.account.area.localeCompare(b.account.area) || (a.oldestOverdue ?? '').localeCompare(b.oldestOverdue ?? ''));
    if (q.due === 'WEEK') rows = rows.filter((r) => Number(r.dueThisWeek) > 0).sort((a, b) => a.account.area.localeCompare(b.account.area) || (a.next?.dueDate ?? '').localeCompare(b.next?.dueDate ?? ''));
    const [types, areas] = await Promise.all([prisma.loanType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }), prisma.area.findMany({ orderBy: { name: 'asc' } })]);
    res.json({ today, weekEnd, loans: rows, loanTypes: types.map(loanTypeJson), areas: areas.map((a) => ({ id: a.id, name: a.name })) });
  }),
);

/** The cards on Home. */
loansRouter.get(
  '/summary',
  wrap(async (req, res) => {
    const today = todayManila();
    const weekEnd = addDays(today, DUE_SOON_DAYS - 1);
    const [released, forApproval, approved] = await Promise.all([
      prisma.loan.findMany({ where: { status: 'RELEASED' }, include: loanInclude }),
      prisma.loan.count({ where: { status: 'FOR_APPROVAL' } }),
      prisma.loan.count({ where: { status: 'APPROVED' } }),
    ]);
    let balance = new Prisma.Decimal(0);
    let weekAmount = new Prisma.Decimal(0);
    let weekCount = 0;
    let overdueAmount = new Prisma.Decimal(0);
    let overdueCount = 0;
    for (const loan of released) {
      const s = summaryOf(loan, today);
      balance = balance.plus(s.balance);
      const week = dueBetween(loan, today, weekEnd, today);
      if (week.gt(0)) {
        weekCount += 1;
        weekAmount = weekAmount.plus(week);
      }
      if (s.overdueCount > 0) {
        overdueCount += 1;
        overdueAmount = overdueAmount.plus(s.overdueAmount);
      }
    }
    res.json({
      active: { count: released.length, balance: balance.toFixed(2) },
      dueThisWeek: { count: weekCount, amount: weekAmount.toFixed(2) },
      overdue: { count: overdueCount, amount: overdueAmount.toFixed(2) },
      // Shown only to those who can act on them.
      forApproval: req.work?.has('APPROVE_LOANS') ? forApproval : null,
      readyToRelease: req.work?.has('CASHIER') ? approved : null,
    });
  }),
);

// ---- Loan types (Admin) ----------------------------------------------------------------------------

const typeSchema = z
  .object({
    name: z.string({ required_error: 'Please type the name of the loan type.' }).trim().min(1, 'Please type the name of the loan type.').max(80),
    monthlyRate: percent('the interest rate'),
    minMonths: z.coerce.number().int().min(1, 'The shortest term must be at least 1 month.').max(360),
    maxMonths: z.coerce.number().int().min(1).max(360, 'The longest term must be 360 months or less.'),
    serviceChargePercent: percent('the service charge'),
    tscType: z.enum(['AMOUNT', 'PERCENT']),
    tscValue: money('the TSC'),
    notarialFee: money('the notarial fee'),
    otherChargeLabel: z.string().trim().max(60).default(''),
    otherChargeAmount: money('the other charge'),
    penaltyType: z.enum(['NONE', 'PERCENT', 'AMOUNT']),
    penaltyValue: money('the late penalty'),
    active: z.boolean().default(true),
  })
  .refine((t) => t.minMonths <= t.maxMonths, { message: 'The shortest term cannot be longer than the longest term.' })
  .refine((t) => t.tscType !== 'PERCENT' || t.tscValue.lte(100), { message: 'The TSC percent must be 100 or less.' })
  .refine((t) => t.penaltyType !== 'PERCENT' || t.penaltyValue.lte(100), { message: 'The penalty percent must be 100 or less.' });

const typeData = (t: z.infer<typeof typeSchema>) => ({
  ...t,
  monthlyRate: new Prisma.Decimal(t.monthlyRate),
  serviceChargePercent: new Prisma.Decimal(t.serviceChargePercent),
});

loansRouter.get(
  '/types',
  wrap(async (_req, res) => {
    const types = await prisma.loanType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { changes: { orderBy: { id: 'desc' }, take: 20, include: { changedBy: { select: { name: true } } } } } });
    res.json({
      loanTypes: types.map((t) => ({
        ...loanTypeJson(t),
        changes: t.changes.map((c) => ({ at: c.changedAt.toISOString(), by: c.changedBy?.name ?? null, reason: c.reason, before: c.before, after: c.after })),
      })),
    });
  }),
);

loansRouter.post(
  '/types',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const data = typeSchema.parse(req.body);
    if (await prisma.loanType.findUnique({ where: { name: data.name } })) throw new AppError(409, 'There is already a loan type with this name.');
    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.loanType.create({ data: typeData(data) });
      await tx.loanTypeChange.create({ data: { loanTypeId: t.id, after: loanTypeJson(t), reason: 'Added', changedById: req.user!.id } });
      await audit(tx, req.user!.id, 'loan-type.create', 'loan_type', t.id, null, loanTypeJson(t));
      return t;
    });
    res.status(201).json(loanTypeJson(created));
  }),
);

loansRouter.put(
  '/types/:id',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan type');
    const data = typeSchema.parse(req.body);
    const why = reason('changing the loan type').parse(req.body?.reason);
    const before = await prisma.loanType.findUnique({ where: { id } });
    if (!before) throw notFound('This loan type');
    const clash = await prisma.loanType.findUnique({ where: { name: data.name } });
    if (clash && clash.id !== id) throw new AppError(409, 'There is already a loan type with this name.');
    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.loanType.update({ where: { id }, data: typeData(data) });
      await tx.loanTypeChange.create({ data: { loanTypeId: id, before: loanTypeJson(before), after: loanTypeJson(t), reason: why, changedById: req.user!.id } });
      await audit(tx, req.user!.id, 'loan-type.update', 'loan_type', id, loanTypeJson(before), { ...loanTypeJson(t), reason: why });
      return t;
    });
    res.json(loanTypeJson(updated));
  }),
);

// ---- One member ------------------------------------------------------------------------------------

/** "Can borrow up to", and the member's loans, for the profile and the wizard. */
loansRouter.get(
  '/member/:accountId',
  wrap(async (req, res) => {
    const accountId = idParam(req.params.accountId, 'This account');
    const account = await prisma.account.findUnique({ where: { id: accountId }, include: { area: true } });
    if (!account) throw notFound('This account');
    const [limit, loans] = await Promise.all([
      borrowLimit(prisma, accountId),
      prisma.loan.findMany({ where: { accountId }, include: loanInclude, orderBy: { id: 'desc' } }),
    ]);
    res.json({
      account: { id: account.id, fullName: account.fullName, accountNumber: account.accountNumber, memberNumber: account.isMember ? account.memberNumber : null, area: account.area.name, isMember: account.isMember, openingShareCapital: account.openingShareCapital.toFixed(2) },
      limit: limitJson(limit),
      loans: await Promise.all(loans.map((l) => loanJson(l))),
    });
  }),
);

/** Admin: share capital paid before the system, from the paper records. */
loansRouter.put(
  '/member/:accountId/opening-share-capital',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const accountId = idParam(req.params.accountId, 'This account');
    const { amount, reason: why } = z.object({ amount: money('the share capital'), reason: z.string().default('') }).parse(req.body);
    const account = await setOpeningShareCapital(accountId, amount, why, req.user!.id);
    res.json({ openingShareCapital: account.openingShareCapital.toFixed(2), limit: limitJson(await borrowLimit(prisma, accountId)) });
  }),
);

// ---- Applying, deciding, releasing -----------------------------------------------------------------

/** The review screen's figures, without saving anything. */
loansRouter.post(
  '/quote',
  allowWork('LOANS'),
  wrap(async (req, res) => {
    const data = requestSchema.parse(req.body);
    const [q, limit] = await Promise.all([quote(prisma, data), borrowLimit(prisma, data.accountId)]);
    res.json({ ...quoteJson(q), limit: limitJson(limit), overLimit: q.principal.gt(limit.limit) });
  }),
);

loansRouter.post(
  '/',
  allowWork('LOANS'),
  wrap(async (req, res) => {
    const data = requestSchema.parse(req.body);
    const loan = await applyForLoan(data, req.user!);
    res.status(201).json(await loanJson(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: loanInclude })));
  }),
);

loansRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan');
    const loan = await prisma.loan.findUnique({ where: { id }, include: loanInclude });
    if (!loan) throw notFound('This loan');
    res.set('Cache-Control', 'no-store');
    res.json(await loanJson(loan, { withPayoff: true }));
  }),
);

const done = async (id: number) => loanJson(await prisma.loan.findUniqueOrThrow({ where: { id }, include: loanInclude }), { withPayoff: true });

loansRouter.post(
  '/:id/approve',
  allowWork('APPROVE_LOANS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan');
    await approveLoan(id, req.user!);
    res.json(await done(id));
  }),
);

loansRouter.post(
  '/:id/reject',
  allowWork('APPROVE_LOANS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan');
    await rejectLoan(id, reason('rejecting this loan').parse(req.body?.reason), req.user!);
    res.json(await done(id));
  }),
);

loansRouter.post(
  '/:id/cancel',
  allowWork('LOANS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan');
    await cancelLoan(id, reason('cancelling this loan').parse(req.body?.reason), req.user!);
    res.json(await done(id));
  }),
);

loansRouter.post(
  '/:id/release',
  allowWork('CASHIER'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan');
    const data = z
      .object({ releaseDate: z.string({ required_error: 'Please choose the date the cash was given.' }), cashGiven: money('the cash given') })
      .parse(req.body);
    await releaseLoan(id, data, req.user!);
    res.json(await done(id));
  }),
);

/** How a payment would be split, for the Cashier screen (nothing is saved). */
loansRouter.get(
  '/:id/split',
  allowWork('CASHIER'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This loan');
    const q = z.object({ amount: money('the payment'), payoff: z.enum(['true', 'false']).default('false') }).parse(req.query);
    if (q.amount.lte(0)) throw new AppError(400, 'Please enter an amount greater than zero.');
    const loan = await prisma.loan.findUnique({ where: { id }, include: loanInclude });
    if (!loan) throw notFound('This loan');
    const rule = (await getSettings(prisma)).loan_payoff_rule as PayoffRule;
    const splits = splitFor(loan, q.amount, q.payoff === 'true', rule);
    const total = (k: 'penalty' | 'interest' | 'principal') => splits.reduce((s, x) => s.plus(x[k]), new Prisma.Decimal(0)).toFixed(2);
    res.json({ penalty: total('penalty'), interest: total('interest'), principal: total('principal') });
  }),
);
