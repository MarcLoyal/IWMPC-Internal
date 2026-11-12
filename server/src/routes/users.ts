import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { idParam } from '../lib/params';
import { userJson } from '../lib/serialize';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';

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
    const users = await prisma.user.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    res.json({ users: users.map(userJson) });
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
    res.json(userJson(user));
  }),
);
