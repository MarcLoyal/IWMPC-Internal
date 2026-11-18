import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { idParam } from '../lib/params';
import { userJson } from '../lib/serialize';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { closeEndedGrants, grantAudit, grantJson, grantPeople } from '../services/access';
import { isDateString, todayManila, toDbDate } from '../lib/dates';
import { CAN_GET_EXTRA, ROLE_WORK, WORK, WORK_KEYS, type Work } from '../lib/work';

export const usersRouter = Router();
usersRouter.use(allow('ADMIN'));

const name = z.string({ required_error: 'Please type the name.' }).trim().min(1, 'Please type the name.').max(120);
const email = z
  .string({ required_error: 'Please type the email.' })
  .trim()
  .toLowerCase()
  .email('Please type a valid email address.');
const password = z
  .string({ required_error: 'Please type a password.' })
  .min(8, 'The password must be at least 8 characters long.')
  .max(100);
const role = z.enum(['ADMIN', 'CASHIER', 'STAFF', 'BOARD'], { errorMap: () => ({ message: 'Please choose a role.' }) });

usersRouter.get(
  '/',
  wrap(async (_req, res) => {
    await closeEndedGrants();
    const users = await prisma.user.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: { accessGrants: { include: grantPeople, orderBy: { grantedAt: 'desc' }, take: 20 } },
    });
    res.json({
      users: users.map((u) => ({
        ...userJson(u),
        roleWork: ROLE_WORK[u.role],
        canGetExtra: CAN_GET_EXTRA.includes(u.role),
        grants: u.accessGrants.map(grantJson),
      })),
      work: WORK_KEYS.map((key) => ({ key, label: WORK[key] })),
    });
  }),
);

usersRouter.post(
  '/',
  wrap(async (req, res) => {
    const data = z.object({ name, email, password, role }).parse(req.body);
    if (await prisma.user.findUnique({ where: { email: data.email } })) {
      throw new AppError(409, 'There is already a user with this email.');
    }
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, role: data.role, passwordHash: await bcrypt.hash(data.password, 10) },
    });
    await audit(prisma, req.user!.id, 'user.create', 'user', user.id, null, userJson(user));
    res.status(201).json(userJson(user));
  }),
);

usersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This user');
    const data = z
      .object({ name, role, status: z.enum(['ACTIVE', 'INACTIVE']), password: password.optional().or(z.literal('')) })
      .parse(req.body);
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw notFound('This user');

    // Never leave the system without an active admin.
    const losesAdmin = before.role === 'ADMIN' && before.status === 'ACTIVE' && (data.role !== 'ADMIN' || data.status !== 'ACTIVE');
    if (losesAdmin) {
      const otherAdmins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', NOT: { id } } });
      if (otherAdmins === 0) throw new AppError(400, 'There must be at least one active Admin.');
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        role: data.role,
        status: data.status,
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 10) } : {}),
      },
    });
    await audit(prisma, req.user!.id, data.password ? 'user.update+password' : 'user.update', 'user', id, userJson(before), userJson(user));

    // An Admin already has everything and Board stays view only, so open extra access ends here.
    if (!CAN_GET_EXTRA.includes(user.role)) {
      const open = await prisma.accessGrant.findMany({ where: { userId: id, removedAt: null } });
      for (const grant of open) {
        const why = `Role changed to ${user.role === 'ADMIN' ? 'Admin' : 'Board'}`;
        await prisma.$transaction(async (tx) => {
          await tx.accessGrant.update({ where: { id: grant.id }, data: { removedAt: new Date(), removedById: req.user!.id, removeReason: why } });
          await audit(tx, req.user!.id, 'user.access-remove', 'user', id, grantAudit(grant), { ...grantAudit(grant), removeReason: why });
        });
      }
    }
    res.json(userJson(user));
  }),
);

const grantSchema = z.object({
  work: z.enum(WORK_KEYS as [Work, ...Work[]], { errorMap: () => ({ message: 'Please choose the work to give.' }) }),
  requestedBy: z
    .string({ required_error: 'Please type who asked for this access.' })
    .trim()
    .min(1, 'Please type who asked for this access.')
    .max(120),
  reason: z.string({ required_error: 'Please type the reason.' }).trim().min(1, 'Please type the reason.').max(300),
  endsOn: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isDateString(v), 'Please choose a valid end date.'),
});

// Admin: give one user extra work beyond their role, on request.
usersRouter.post(
  '/:id/access',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This user');
    const data = grantSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('This user');
    if (user.status !== 'ACTIVE') throw new AppError(400, 'This user is deactivated. Activate them first.');
    if (user.role === 'ADMIN') throw new AppError(400, 'Admins can already do everything.');
    if (!CAN_GET_EXTRA.includes(user.role)) throw new AppError(400, 'Board members are view only and cannot be given extra access.');
    if (ROLE_WORK[user.role].includes(data.work)) throw new AppError(400, 'This work is already part of their role.');
    if (data.endsOn && data.endsOn < todayManila()) throw new AppError(400, 'The end date cannot be in the past.');

    await closeEndedGrants({ userId: id });
    const grant = await prisma.$transaction(async (tx) => {
      // Lock the user row so two Admins cannot give the same access twice at the same moment.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      if (await tx.accessGrant.findFirst({ where: { userId: id, work: data.work, removedAt: null } })) {
        throw new AppError(409, 'This user already has this access.');
      }
      const created = await tx.accessGrant.create({
        data: {
          userId: id,
          work: data.work,
          requestedBy: data.requestedBy,
          reason: data.reason,
          endsOn: data.endsOn ? toDbDate(data.endsOn) : null,
          grantedById: req.user!.id,
        },
        include: grantPeople,
      });
      await audit(tx, req.user!.id, 'user.access-grant', 'user', id, null, grantAudit(created));
      return created;
    });
    res.status(201).json(grantJson(grant));
  }),
);

// Admin: take extra access away before its end date.
usersRouter.post(
  '/:id/access/:grantId/remove',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This user');
    const grantId = idParam(req.params.grantId, 'This access');
    const { reason } = z.object({ reason: z.string().trim().max(300).optional().default('') }).parse(req.body);
    const grant = await prisma.$transaction(async (tx) => {
      const before = await tx.accessGrant.findFirst({ where: { id: grantId, userId: id } });
      if (!before) throw notFound('This access');
      const closed = await tx.accessGrant.updateMany({
        where: { id: grantId, removedAt: null },
        data: { removedAt: new Date(), removedById: req.user!.id, removeReason: reason || null },
      });
      if (closed.count === 0) throw new AppError(409, 'This access has already ended.');
      await audit(tx, req.user!.id, 'user.access-remove', 'user', id, grantAudit(before), { ...grantAudit(before), removeReason: reason || null });
      return tx.accessGrant.findUniqueOrThrow({ where: { id: grantId }, include: grantPeople });
    });
    res.json(grantJson(grant));
  }),
);
