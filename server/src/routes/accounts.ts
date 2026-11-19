import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { isDateString, toDbDate, todayManila } from '../lib/dates';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { accountDetail, accountRow, connectionJson, paymentJson } from '../lib/serialize';
import { allow, allowWork, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { NO_ACTIVE_CONNECTION, cannotApply, decideMembership, startMembership, type MembershipDetails } from '../services/membership';
import { nextNumber } from '../services/numbering';
import { getSettings } from '../services/settings';
import { getOwed, installationFeePaid } from '../services/payments';
import { addMonths, isPeriod, periodOf } from '../lib/periods';
import { fromDbDate } from '../lib/dates';
import { saleItemJson } from '../lib/serialize';
import { saleBalance } from '../services/sales';
import { displayNumber } from '../lib/orNumbers';
import { billJson, billState, unpaidBills, type BillStatus } from '../services/water';

export const accountsRouter = Router();

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || isDateString(v), 'Please enter a valid date.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const text = (max: number) => z.string().trim().max(max).default('');

/** Personal details, as written on IWMPC's paper forms. */
const accountSchema = z.object({
  lastName: z.string({ required_error: 'Please type the family name.' }).trim().min(1, 'Please type the family name.').max(60),
  firstName: z.string({ required_error: 'Please type the given name.' }).trim().min(1, 'Please type the given name.').max(60),
  middleName: text(60),
  areaId: z.coerce.number({ invalid_type_error: 'Please choose an area.' }).int().positive('Please choose an area.'),
  purok: text(80),
  barangay: text(80),
  municipality: text(80),
  province: text(80),
  phone: text(50),
  birthDate: optionalDate,
  civilStatus: z.enum(['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED']).nullable().optional(),
  sex: z.enum(['MALE', 'FEMALE']).nullable().optional(),
  tin: text(30),
  religion: text(80),
  education: text(120),
  idType: text(80),
  idNumber: text(80),
});

type AccountInput = z.infer<typeof accountSchema>;

/** Turns the form into database columns, including the combined name and address. */
function accountColumns(data: AccountInput) {
  return {
    ...data,
    fullName: [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' '),
    address: [data.purok, data.barangay, data.municipality, data.province].filter(Boolean).join(', '),
    birthDate: data.birthDate ? toDbDate(data.birthDate) : null,
    civilStatus: data.civilStatus ?? null,
    sex: data.sex ?? null,
  };
}

const beneficiariesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1, "Please type the beneficiary's name.").max(150),
      relationship: z.string().trim().max(80).default(''),
    }),
  )
  .max(10)
  .default([]);

const optionalMoney = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const parsed = parseMoney(String(v));
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Please enter a valid amount for the share capital.' });
      return z.NEVER;
    }
    return parsed;
  });

/** The rest of the Application for Membership form. */
const membershipSchema = z.object({
  membershipAppliedOn: optionalDate,
  membershipPurpose: text(250),
  sharesSubscribed: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
        ctx.addIssue({ code: 'custom', message: 'Please enter a whole number for the number of shares.' });
        return z.NEVER;
      }
      return n;
    }),
  sharesAmount: optionalMoney,
  meterRegisteredName: text(150),
  pmesAttended: z.boolean().nullable().optional(),
  // The Board's decision is not part of what Staff can enter: only the Admin records it
  // (POST /:id/membership-decision). Anything sent here is ignored.
});

function membershipColumns(data: z.infer<typeof membershipSchema>): MembershipDetails {
  return {
    membershipAppliedOn: data.membershipAppliedOn ? toDbDate(data.membershipAppliedOn) : null,
    membershipPurpose: data.membershipPurpose,
    sharesSubscribed: data.sharesSubscribed,
    sharesAmount: data.sharesAmount,
    meterRegisteredName: data.meterRegisteredName,
    pmesAttended: data.pmesAttended ?? null,
  };
}

/** Every word typed must appear in the name, account number, or member number. */
function searchFilter(search: string): Prisma.AccountWhereInput {
  const words = search.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  return {
    AND: words.map((word) => ({
      OR: [
        { fullName: { contains: word, mode: 'insensitive' as const } },
        { accountNumber: { contains: word, mode: 'insensitive' as const } },
        { isMember: true, memberNumber: { contains: word, mode: 'insensitive' as const } },
      ],
    })),
  };
}

const WORST: BillStatus[] = ['PAID', 'UNPAID', 'DUE_SOON', 'OVERDUE'];
const worse = (a: BillStatus, b: BillStatus) => (WORST.indexOf(a) >= WORST.indexOf(b) ? a : b);

/** The water columns of the Accounts list: current bill, a 12-month strip, and older unpaid balance. */
async function waterSummaries(accountIds: number[], months: string[], today: string) {
  const recent = addMonths(periodOf(today), -1);
  const bills = accountIds.length
    ? await prisma.waterBill.findMany({
        where: {
          connection: { accountId: { in: accountIds } },
          OR: [{ period: { in: months } }, { settledOn: null }, { period: { gte: recent } }],
        },
        include: { payments: true, connection: { select: { accountId: true } } },
      })
    : [];
  const zero = new Prisma.Decimal(0);
  const byAccount = new Map<number, typeof bills>();
  for (const bill of bills) {
    const list = byAccount.get(bill.connection.accountId) ?? [];
    list.push(bill);
    byAccount.set(bill.connection.accountId, list);
  }

  return (accountId: number) => {
    const list = (byAccount.get(accountId) ?? []).map((bill) => ({ bill, state: billState(bill, bill.payments, today) }));
    const inMonth = (period: string) => list.filter((x) => x.bill.period === period);
    const total = (items: typeof list, pick: (x: (typeof list)[number]) => Prisma.Decimal) =>
      items.reduce((sum, x) => sum.plus(pick(x)), zero);

    const latest = list.map((x) => x.bill.period).filter((p) => p >= recent).sort().pop();
    const current = latest ? inMonth(latest) : [];
    const older = list.filter((x) => !latest || x.bill.period < latest);
    return {
      current: latest
        ? {
            period: latest,
            amount: total(current, (x) => x.bill.amount.plus(x.state.penalty)).toFixed(2),
            balance: total(current, (x) => x.state.balance).toFixed(2),
            status: current.map((x) => x.state.status).reduce(worse),
          }
        : null,
      months: months.map((period) => {
        const items = inMonth(period);
        if (!items.length) return { period, status: 'NONE' as const, amount: null, datePaid: null };
        // The month takes its worst bill's status, so red always means overdue.
        const status = items.map((x) => x.state.status).reduce(worse);
        const paid = status === 'PAID';
        return {
          period,
          status,
          amount: total(items, (x) => x.bill.amount.plus(x.state.penalty)).toFixed(2),
          datePaid: paid ? items.map((x) => x.state.datePaid ?? '').sort().pop() || null : null,
        };
      }),
      previousUnpaid: total(older, (x) => x.state.balance).toFixed(2),
    };
  };
}

/** Narrows the list to accounts whose water bills are Paid, Due soon, or Overdue. */
async function waterFilter(status: string, today: string): Promise<Prisma.AccountWhereInput> {
  if (status === 'paid') {
    return {
      connections: { some: { bills: { some: {} } } },
      NOT: { connections: { some: { bills: { some: { settledOn: null } } } } },
    };
  }
  if (status !== 'due-soon' && status !== 'overdue') return {};
  const overdue = new Set<number>();
  const dueSoon = new Set<number>();
  for (const bill of await unpaidBills(prisma)) {
    const state = billState(bill, bill.payments, today);
    if (state.status === 'OVERDUE') overdue.add(bill.connection.accountId);
    if (state.status === 'DUE_SOON') dueSoon.add(bill.connection.accountId);
  }
  // An account with anything overdue is shown as Overdue, not Due soon.
  const ids = status === 'overdue' ? [...overdue] : [...dueSoon].filter((id) => !overdue.has(id));
  return { id: { in: ids } };
}

// List with search + Type and Area dropdowns. Each dropdown's counts respect the other filters.
accountsRouter.get(
  '/',
  wrap(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const type = req.query.type === 'members' || req.query.type === 'non-members' ? req.query.type : 'all';
    const areaId = Number(req.query.areaId) || null;
    // The list is loaded a page at a time ("Load more").
    const offset = Math.max(0, Math.floor(Number(req.query.offset)) || 0);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(req.query.limit)) || PAGE_SIZE));

    const today = todayManila();
    // The month strip: a chosen year (Jan-Dec), or the last 12 months ending this month.
    const year = typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year) ? req.query.year : null;
    const months = Array.from({ length: 12 }, (_, i) =>
      year ? `${year}-${String(i + 1).padStart(2, '0')}` : addMonths(periodOf(today), i - 11),
    ).filter(isPeriod);
    const byWater = await waterFilter(typeof req.query.water === 'string' ? req.query.water : '', today);

    const bySearch = { AND: [searchFilter(search), byWater] };
    const byType: Prisma.AccountWhereInput = type === 'all' ? {} : { isMember: type === 'members' };
    const byArea: Prisma.AccountWhereInput = areaId ? { areaId } : {};

    const [rows, total, typeGroups, areaGroups, areas] = await Promise.all([
      prisma.account.findMany({
        where: { ...bySearch, ...byType, ...byArea },
        include: { area: true, connections: { select: { status: true } } },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
      prisma.account.count({ where: { ...bySearch, ...byType, ...byArea } }),
      prisma.account.groupBy({ by: ['isMember'], where: { ...bySearch, ...byArea }, _count: true }),
      prisma.account.groupBy({ by: ['areaId'], where: { ...bySearch, ...byType }, _count: true }),
      prisma.area.findMany({ orderBy: { id: 'asc' } }),
    ]);

    // These three only need the page of accounts, so they are asked for together (one wait, not three).
    const [water, recentSales, firstBill] = await Promise.all([
      waterSummaries(rows.map((r) => r.id), months, today),
      // Each account's most recent Rice & LPG purchase.
      rows.length
        ? prisma.sale.findMany({
            where: { accountId: { in: rows.map((r) => r.id) }, status: 'ACTIVE' },
            orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
            distinct: ['accountId'],
            include: { items: { orderBy: { id: 'asc' } } },
          })
        : Promise.resolve([]),
      prisma.waterBill.findFirst({ orderBy: { period: 'asc' }, select: { period: true } }),
    ]);
    const lastPurchase = new Map(
      recentSales.map((sale) => [
        sale.accountId,
        {
          date: fromDbDate(sale.saleDate)!,
          item: sale.items[0]?.productName ?? '',
          moreItems: Math.max(0, sale.items.length - 1),
          amount: sale.total.toFixed(2),
        },
      ]),
    );
    const members = typeGroups.find((g) => g.isMember)?._count ?? 0;
    const nonMembers = typeGroups.find((g) => !g.isMember)?._count ?? 0;
    const areaCount = new Map(areaGroups.map((g) => [g.areaId, g._count]));

    res.json({
      rows: rows.map((r) => ({
        ...accountRow(r),
        // NONE: no connection yet. PENDING: applied but not installed. INSTALLED: has (or had) water.
        connectionState: r.connections.some((c) => c.status !== 'PENDING_INSTALLATION')
          ? 'INSTALLED'
          : r.connections.length
            ? 'PENDING'
            : 'NONE',
        water: water(r.id),
        lastPurchase: lastPurchase.get(r.id) ?? null,
        // A non-member who can apply for membership now (no application in progress, active water).
        canApply: !cannotApply(r.membershipStatus, r.isMember) && r.connections.some((c) => c.status === 'ACTIVE'),
      })),
      offset,
      total,
      months,
      // Years that have bills, newest first, for the year selector.
      years: Array.from(
        { length: Number(today.slice(0, 4)) - Number((firstBill?.period ?? today).slice(0, 4)) + 1 },
        (_, i) => String(Number(today.slice(0, 4)) - i),
      ),
      counts: {
        type: { all: members + nonMembers, members, nonMembers },
        areas: areas.map((a) => ({ id: a.id, name: a.name, count: areaCount.get(a.id) ?? 0 })),
        allAreas: areaGroups.reduce((sum, g) => sum + g._count, 0),
      },
    });
  }),
);

accountsRouter.post(
  '/',
  allowWork('ACCOUNTS'),
  wrap(async (req, res) => {
    const data = accountSchema.parse(req.body);
    if (!(await prisma.area.findUnique({ where: { id: data.areaId } }))) {
      throw new AppError(400, 'Please choose an area.');
    }
    const account = await prisma.$transaction(async (tx) => {
      const accountNumber = await nextNumber(tx, 'account');
      const created = await tx.account.create({
        data: {
          ...accountColumns(data),
          accountNumber,
          createdById: req.user!.id,
        },
      });
      await audit(tx, req.user!.id, 'account.create', 'account', created.id, null, created);
      return created;
    });
    res.status(201).json({ id: account.id, accountNumber: account.accountNumber });
  }),
);

type ApplicationRow = Prisma.MembershipApplicationGetPayload<{
  include: { submittedBy: { select: { name: true } }; decidedBy: { select: { name: true } } };
}>;

function applicationJson(a: ApplicationRow) {
  return {
    id: a.id,
    appliedOn: fromDbDate(a.appliedOn)!,
    submittedAt: a.submittedAt.toISOString(),
    submittedBy: a.submittedBy.name,
    decision: a.decision,
    boardDecisionDate: fromDbDate(a.boardDecisionDate),
    reference: a.reference,
    reason: a.reason,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decidedBy: a.decidedBy?.name ?? null,
  };
}

const APPLICATION_LISTS = {
  FOR_APPROVAL: 'FOR_APPROVAL',
  APPROVED: 'PENDING',
  NOT_APPROVED: 'NOT_APPROVED',
} as const;

// Membership applications by status: waiting for approval (oldest first), approved and waiting for
// the fee, or not approved. Everyone logged in can see the list; only the Admin can decide.
accountsRouter.get(
  '/membership-applications',
  wrap(async (req, res) => {
    const list = (Object.keys(APPLICATION_LISTS) as (keyof typeof APPLICATION_LISTS)[]).find((k) => k === req.query.status) ?? 'FOR_APPROVAL';
    const [accounts, counts] = await Promise.all([
      prisma.account.findMany({
        where: { membershipStatus: APPLICATION_LISTS[list] },
        include: {
          area: true,
          membershipApplications: {
            include: { submittedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ membershipAppliedOn: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      prisma.account.groupBy({ by: ['membershipStatus'], where: { membershipStatus: { in: Object.values(APPLICATION_LISTS) } }, _count: true }),
    ]);
    const count = (status: string) => counts.find((c) => c.membershipStatus === status)?._count ?? 0;
    res.json({
      list,
      counts: { FOR_APPROVAL: count('FOR_APPROVAL'), APPROVED: count('PENDING'), NOT_APPROVED: count('NOT_APPROVED') },
      rows: accounts.map((a) => ({
        id: a.id,
        accountNumber: a.accountNumber,
        fullName: a.fullName,
        area: a.area.name,
        application: a.membershipApplications[0] ? applicationJson(a.membershipApplications[0]) : null,
      })),
    });
  }),
);

// Full profile: details, connections, every payment, and what is owed.
accountsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const account = await prisma.account.findUnique({
      where: { id },
      include: { area: true, beneficiaries: { orderBy: { id: 'asc' } } },
    });
    if (!account) throw notFound('This account');

    const [connections, payments, owed, bills, sales] = await Promise.all([
      prisma.waterConnection.findMany({ where: { accountId: id }, orderBy: { id: 'asc' } }),
      prisma.payment.findMany({
        where: { accountId: id },
        include: { createdBy: { select: { name: true } }, voidedBy: { select: { name: true } }, waterBill: { select: { period: true } }, sale: { include: { items: true } } },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      }),
      getOwed(id),
      prisma.waterBill.findMany({
        where: { connection: { accountId: id } },
        include: { payments: true, reading: true },
        orderBy: [{ period: 'desc' }, { id: 'desc' }],
      }),
      prisma.sale.findMany({
        where: { accountId: id },
        include: { items: { orderBy: { id: 'asc' }, include: { unit: { select: { product: { select: { category: true } } } } } }, payments: true },
        orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
      }),
    ]);
    // The Rice & LPG tab: one row per item bought, newest first. Voided sales stay visible.
    const purchases = sales.flatMap((sale) =>
      sale.items.map((item) => ({
        ...saleItemJson(item),
        category: item.unit.product.category,
        saleId: sale.id,
        date: fromDbDate(sale.saleDate)!,
        status: sale.status,
        isCredit: sale.isCredit,
        balance: sale.isCredit && sale.status === 'ACTIVE' ? saleBalance(sale).toFixed(2) : '0.00',
        orNumbers: [...new Set(sale.payments.filter((p) => p.status === 'ACTIVE').map((p) => displayNumber(p.orNumber)))],
      })),
    );
    const thisYear = todayManila().slice(0, 4);
    const kindThisYear = (kind: string) =>
      purchases
        .filter((p) => p.status === 'ACTIVE' && p.category === kind && p.date.startsWith(thisYear))
        .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0))
        .toFixed(2);
    const boughtThisYear = sales
      .filter((sale) => sale.status === 'ACTIVE' && fromDbDate(sale.saleDate)!.startsWith(thisYear))
      .reduce((sum, sale) => sum.plus(sale.total), new Prisma.Decimal(0));
    // The Water Bill summary card: everything still owed, and the worst status.
    const billRows = bills.map((b) => billJson(b));
    const unpaid = billRows.filter((b) => b.status !== 'PAID');
    const waterDue = unpaid.reduce((sum, b) => sum.plus(b.balance), new Prisma.Decimal(0));

    const hasActive = connections.some((c) => c.status === 'ACTIVE');
    const warnings: string[] = [];
    if (account.isMember && !hasActive) {
      // Rule R8: warn only. Nothing changes automatically.
      warnings.push('This member has no active water connection.');
    }

    res.json({
      account: accountDetail(account),
      connections: connections.map((c) => ({
        ...connectionJson(c),
        // Whether an installation fee payment (not voided) is linked to this connection.
        installationFeePaid: payments.some((p) => p.connectionId === c.id && p.type === 'INSTALLATION_FEE' && p.status === 'ACTIVE'),
      })),
      payments: payments.map(paymentJson),
      bills: billRows,
      purchases,
      riceLpg: {
        year: thisYear,
        totalThisYear: boughtThisYear.toFixed(2),
        riceThisYear: kindThisYear('RICE'),
        lpgThisYear: kindThisYear('LPG'),
        otherThisYear: kindThisYear('OTHER'),
        creditBalance: sales
          .filter((sale) => sale.isCredit && sale.status === 'ACTIVE')
          .reduce((sum, sale) => sum.plus(saleBalance(sale)), new Prisma.Decimal(0))
          .toFixed(2),
      },
      water: {
        hasBills: billRows.length > 0,
        totalDue: waterDue.toFixed(2),
        status: unpaid.length ? unpaid.map((b) => b.status).reduce(worse) : ('PAID' as BillStatus),
        nextDueDate: unpaid.map((b) => b.dueDate).sort()[0] ?? null,
        unpaidMonths: unpaid.length,
      },
      owed,
      warnings,
      canMakeMember: !cannotApply(account.membershipStatus, account.isMember) && hasActive,
      // Every membership application and the Board's decision on it, newest first.
      membershipApplications: (
        await prisma.membershipApplication.findMany({
          where: { accountId: id },
          include: { submittedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
          orderBy: { id: 'desc' },
        })
      ).map(applicationJson),
    });
  }),
);

accountsRouter.put(
  '/:id',
  allowWork('ACCOUNTS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const data = accountSchema.parse(req.body);
    const before = await prisma.account.findUnique({ where: { id }, include: { beneficiaries: true } });
    if (!before) throw notFound('This account');
    if (!(await prisma.area.findUnique({ where: { id: data.areaId } }))) {
      throw new AppError(400, 'Please choose an area.');
    }
    // Membership details can be edited only after "Make a Member". Whether the account
    // IS a member is never changed here.
    const applied = before.membershipStatus !== 'NONE';
    const membership = applied ? membershipColumns(membershipSchema.parse(req.body)) : {};
    const beneficiaries = applied && req.body.beneficiaries !== undefined ? beneficiariesSchema.parse(req.body.beneficiaries) : null;

    await prisma.$transaction(async (tx) => {
      const after = await tx.account.update({ where: { id }, data: { ...accountColumns(data), ...membership } });
      if (beneficiaries) {
        await tx.beneficiary.deleteMany({ where: { accountId: id } });
        if (beneficiaries.length) {
          await tx.beneficiary.createMany({ data: beneficiaries.map((b) => ({ ...b, accountId: id })) });
        }
      }
      await audit(tx, req.user!.id, 'account.update', 'account', id, before, { ...after, beneficiaries });
    });
    res.json({ ok: true });
  }),
);

// "Make a Member": saves the whole Application for Membership form, then waits for the fee.
accountsRouter.post(
  '/:id/make-member',
  allowWork('ACCOUNTS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) throw notFound('This account');
    const problem = cannotApply(account.membershipStatus, account.isMember);
    if (problem) throw new AppError(400, problem);
    if ((await prisma.waterConnection.count({ where: { accountId: id, status: 'ACTIVE' } })) === 0) {
      throw new AppError(400, NO_ACTIVE_CONNECTION);
    }

    const personal = accountSchema.parse(req.body);
    const membership = membershipSchema.parse(req.body);
    const beneficiaries = beneficiariesSchema.parse(req.body?.beneficiaries);
    if (!(await prisma.area.findUnique({ where: { id: personal.areaId } }))) {
      throw new AppError(400, 'Please choose an area.');
    }
    // Needed on the membership form.
    if (!personal.birthDate) throw new AppError(400, 'Please enter the birthday.');
    if (!personal.sex) throw new AppError(400, 'Please choose the sex.');
    if (!personal.civilStatus) throw new AppError(400, 'Please choose the civil status.');
    if (!membership.membershipAppliedOn) membership.membershipAppliedOn = todayManila();

    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id }, data: accountColumns(personal) });
      await startMembership(tx, id, beneficiaries, req.user!.id, membershipColumns(membership));
    });
    res.json({ ok: true });
  }),
);

const connectionSchema = z.object({
  applicationDate: optionalDate,
  rateClass: z.enum(['RESIDENTIAL', 'COMMERCIAL']).default('RESIDENTIAL'),
  meterName: z.string().trim().max(150).default(''),
  meterSerial: z.string().trim().max(60).default(''),
  address: z.string().trim().max(250).default(''),
  remarks: z.string().trim().max(500).default(''),
});

// Admin only: records the Board's decision on a waiting membership application.
accountsRouter.post(
  '/:id/membership-decision',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const input = z
      .object({
        decision: z.enum(['APPROVED', 'DISAPPROVED'], { errorMap: () => ({ message: 'Please choose Approved or Not approved.' }) }),
        boardDecisionDate: z
          .string({ required_error: 'Please enter the date of the Board decision.' })
          .refine(isDateString, 'Please enter the date of the Board decision.'),
        reference: text(100),
        reason: text(300),
      })
      .parse(req.body);
    await prisma.$transaction((tx) => decideMembership(tx, id, input, req.user!.id));
    res.json({ ok: true });
  }),
);

accountsRouter.post(
  '/:id/connections',
  allowWork('ACCOUNTS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const data = connectionSchema.parse(req.body);
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) throw notFound('This account');
    // A meter can only be on one connection.
    if (data.meterSerial) {
      const existing = await prisma.waterConnection.findFirst({
        where: { meterSerial: { equals: data.meterSerial, mode: 'insensitive' } },
        include: { account: { select: { fullName: true } } },
      });
      if (existing) {
        throw new AppError(409, `Water meter serial number ${data.meterSerial} is already used by ${existing.account.fullName}.`);
      }
    }
    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.waterConnection.create({
        data: {
          accountId: id,
          // Staff never type this. It is the system's own reference, set just below.
          connectionNumber: `new-${randomUUID()}`,
          applicationDate: toDbDate(data.applicationDate ?? todayManila()),
          rateClass: data.rateClass,
          meterName: data.meterName,
          meterSerial: data.meterSerial,
          address: data.address || account.address,
          remarks: data.remarks,
        },
      });
      const numbered = await tx.waterConnection.update({
        where: { id: created.id },
        data: { connectionNumber: `C-${String(created.id).padStart(5, '0')}` },
      });
      await audit(tx, req.user!.id, 'connection.create', 'connection', created.id, null, numbered);
      return numbered;
    });
    res.status(201).json(connectionJson(connection));
  }),
);

export const connectionsRouter = Router();

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISCONNECTED'], { errorMap: () => ({ message: 'Please choose a status.' }) }),
  installationDate: optionalDate,
  // What the meter shows on the day it is installed.
  initialReading: z.coerce
    .number({ invalid_type_error: 'Please enter the meter reading as a whole number.' })
    .int('Please enter the meter reading as a whole number.')
    .min(0)
    .max(99_999_999)
    .optional(),
  // Admin only: marks a connection Active although no installation fee was received in the system
  // (paid on paper before the system was used, or waived). Required reason; kept in the Audit Log.
  feeNotPaidReason: z.string().trim().max(200).optional(),
});

// Pending Installation -> Active -> Disconnected (and Disconnected -> Active to reconnect).
connectionsRouter.patch(
  '/:id',
  allowWork('ACCOUNTS'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This connection');
    const { status, installationDate, initialReading, feeNotPaidReason } = statusSchema.parse(req.body);
    const before = await prisma.waterConnection.findUnique({ where: { id } });
    if (!before) throw notFound('This connection');
    if (before.status === status) throw new AppError(400, 'The connection already has this status.');
    if (before.status === 'PENDING_INSTALLATION' && status === 'DISCONNECTED') {
      throw new AppError(400, 'This connection is not installed yet, so it cannot be disconnected.');
    }
    const firstActivation = before.status === 'PENDING_INSTALLATION' && status === 'ACTIVE';
    // The installation fee must be received (at the Cashier) before a new connection can be Active.
    let feeNote = '';
    if (firstActivation) {
      const fee = new Prisma.Decimal((await getSettings(prisma)).installation_fee);
      const paid = await installationFeePaid(prisma, id);
      if (fee.gt(0) && !paid) {
        if (!feeNotPaidReason) {
          throw new AppError(
            400,
            `The installation fee (₱${fee.toFixed(2)}) has not been paid for this connection yet. Receive it at the Cashier first, then mark the connection Active.`,
          );
        }
        if (req.user!.role !== 'ADMIN') {
          throw new AppError(403, 'Only the Admin can mark a connection Active when the installation fee was not received in the system.');
        }
        feeNote = feeNotPaidReason;
      }
    }
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.waterConnection.update({
        where: { id },
        data: {
          status,
          installationDate: firstActivation ? toDbDate(installationDate ?? todayManila()) : before.installationDate,
          initialReading: firstActivation ? (initialReading ?? 0) : before.initialReading,
        },
      });
      await audit(tx, req.user!.id, 'connection.status', 'connection', id, before, feeNote ? { ...updated, installationFeeNotPaidReason: feeNote } : updated);
      return updated;
    });
    res.json(connectionJson(after));
  }),
);
