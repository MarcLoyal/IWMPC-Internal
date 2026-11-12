import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { isDateString, toDbDate, todayManila } from '../lib/dates';
import { idParam } from '../lib/params';
import { accountDetail, accountRow, connectionJson, paymentJson } from '../lib/serialize';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { startMembership } from '../services/membership';
import { nextNumber } from '../services/numbering';
import { getOwed } from '../services/payments';

export const accountsRouter = Router();

const MAX_ROWS = 200;

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || isDateString(v), 'Please enter a valid date.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const accountSchema = z.object({
  fullName: z.string({ required_error: 'Please type the full name.' }).trim().min(1, 'Please type the full name.').max(150),
  areaId: z.coerce.number({ invalid_type_error: 'Please choose an area.' }).int().positive('Please choose an area.'),
  address: z.string().trim().max(250).default(''),
  phone: z.string().trim().max(50).default(''),
  birthDate: optionalDate,
  civilStatus: z.enum(['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED']).nullable().optional(),
  idType: z.string().trim().max(80).default(''),
  idNumber: z.string().trim().max(80).default(''),
});

const beneficiariesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1, "Please type the beneficiary's name.").max(150),
      relationship: z.string().trim().max(80).default(''),
    }),
  )
  .max(10)
  .default([]);

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

// List with search + Type and Area dropdowns. Each dropdown's counts respect the other filters.
accountsRouter.get(
  '/',
  wrap(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const type = req.query.type === 'members' || req.query.type === 'non-members' ? req.query.type : 'all';
    const areaId = Number(req.query.areaId) || null;

    const bySearch = searchFilter(search);
    const byType: Prisma.AccountWhereInput = type === 'all' ? {} : { isMember: type === 'members' };
    const byArea: Prisma.AccountWhereInput = areaId ? { areaId } : {};

    const [rows, total, typeGroups, areaGroups, areas] = await Promise.all([
      prisma.account.findMany({
        where: { ...bySearch, ...byType, ...byArea },
        include: { area: true },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: MAX_ROWS,
      }),
      prisma.account.count({ where: { ...bySearch, ...byType, ...byArea } }),
      prisma.account.groupBy({ by: ['isMember'], where: { ...bySearch, ...byArea }, _count: true }),
      prisma.account.groupBy({ by: ['areaId'], where: { ...bySearch, ...byType }, _count: true }),
      prisma.area.findMany({ orderBy: { id: 'asc' } }),
    ]);

    const members = typeGroups.find((g) => g.isMember)?._count ?? 0;
    const nonMembers = typeGroups.find((g) => !g.isMember)?._count ?? 0;
    const areaCount = new Map(areaGroups.map((g) => [g.areaId, g._count]));

    res.json({
      rows: rows.map(accountRow),
      total,
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
  allow('ADMIN', 'STAFF'),
  wrap(async (req, res) => {
    const data = accountSchema.parse(req.body);
    if (!(await prisma.area.findUnique({ where: { id: data.areaId } }))) {
      throw new AppError(400, 'Please choose an area.');
    }
    const account = await prisma.$transaction(async (tx) => {
      const accountNumber = await nextNumber(tx, 'account');
      const created = await tx.account.create({
        data: {
          ...data,
          birthDate: data.birthDate ? toDbDate(data.birthDate) : null,
          civilStatus: data.civilStatus ?? null,
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

    const [connections, payments, owed] = await Promise.all([
      prisma.waterConnection.findMany({ where: { accountId: id }, orderBy: { id: 'asc' } }),
      prisma.payment.findMany({
        where: { accountId: id },
        include: { createdBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      }),
      getOwed(id),
    ]);

    const hasActive = connections.some((c) => c.status === 'ACTIVE');
    const warnings: string[] = [];
    if (account.isMember && !hasActive) {
      // Rule R8: warn only. Nothing changes automatically.
      warnings.push('This member has no active water connection.');
    }

    res.json({
      account: accountDetail(account),
      connections: connections.map(connectionJson),
      payments: payments.map(paymentJson),
      owed,
      warnings,
      canMakeMember: !account.isMember && account.membershipStatus === 'NONE' && hasActive,
    });
  }),
);

accountsRouter.put(
  '/:id',
  allow('ADMIN', 'STAFF'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    // Only personal details can be edited here. Membership changes go through Make a Member.
    const data = accountSchema.parse(req.body);
    const beneficiaries = req.body.beneficiaries === undefined ? null : beneficiariesSchema.parse(req.body.beneficiaries);
    const before = await prisma.account.findUnique({ where: { id }, include: { beneficiaries: true } });
    if (!before) throw notFound('This account');
    if (!(await prisma.area.findUnique({ where: { id: data.areaId } }))) {
      throw new AppError(400, 'Please choose an area.');
    }
    await prisma.$transaction(async (tx) => {
      const after = await tx.account.update({
        where: { id },
        data: {
          ...data,
          birthDate: data.birthDate ? toDbDate(data.birthDate) : null,
          civilStatus: data.civilStatus ?? null,
        },
      });
      if (beneficiaries && before.membershipStatus !== 'NONE') {
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

accountsRouter.post(
  '/:id/make-member',
  allow('ADMIN', 'STAFF'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const beneficiaries = beneficiariesSchema.parse(req.body?.beneficiaries);
    await prisma.$transaction((tx) => startMembership(tx, id, beneficiaries, req.user!.id));
    res.json({ ok: true });
  }),
);

const connectionSchema = z.object({
  connectionNumber: z
    .string({ required_error: 'Please type the connection or meter number.' })
    .trim()
    .min(1, 'Please type the connection or meter number.')
    .max(50),
  address: z.string().trim().max(250).default(''),
});

accountsRouter.post(
  '/:id/connections',
  allow('ADMIN', 'STAFF'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This account');
    const data = connectionSchema.parse(req.body);
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) throw notFound('This account');
    const existing = await prisma.waterConnection.findUnique({
      where: { connectionNumber: data.connectionNumber },
      include: { account: { select: { fullName: true } } },
    });
    if (existing) {
      throw new AppError(
        409,
        `Connection number ${data.connectionNumber} is already used by ${existing.account.fullName}.`,
      );
    }
    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.waterConnection.create({
        data: { accountId: id, connectionNumber: data.connectionNumber, address: data.address || account.address },
      });
      await audit(tx, req.user!.id, 'connection.create', 'connection', created.id, null, created);
      return created;
    });
    res.status(201).json(connectionJson(connection));
  }),
);

export const connectionsRouter = Router();

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISCONNECTED'], { errorMap: () => ({ message: 'Please choose a status.' }) }),
  installationDate: optionalDate,
});

// Pending Installation -> Active -> Disconnected (and Disconnected -> Active to reconnect).
connectionsRouter.patch(
  '/:id',
  allow('ADMIN', 'STAFF'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This connection');
    const { status, installationDate } = statusSchema.parse(req.body);
    const before = await prisma.waterConnection.findUnique({ where: { id } });
    if (!before) throw notFound('This connection');
    if (before.status === status) throw new AppError(400, 'The connection already has this status.');
    if (before.status === 'PENDING_INSTALLATION' && status === 'DISCONNECTED') {
      throw new AppError(400, 'This connection is not installed yet, so it cannot be disconnected.');
    }
    const firstActivation = before.status === 'PENDING_INSTALLATION' && status === 'ACTIVE';
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.waterConnection.update({
        where: { id },
        data: {
          status,
          installationDate: firstActivation ? toDbDate(installationDate ?? todayManila()) : before.installationDate,
        },
      });
      await audit(tx, req.user!.id, 'connection.status', 'connection', id, before, updated);
      return updated;
    });
    res.json(connectionJson(after));
  }),
);
