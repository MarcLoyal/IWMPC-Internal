import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { userJson } from '../lib/serialize';
import { endSession, requireUser, startSession, wrap } from '../middleware/auth';
import { audit } from '../services/audit';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string({ required_error: 'Please type your email.' }).trim().toLowerCase().min(1, 'Please type your email.'),
  password: z.string({ required_error: 'Please type your password.' }).min(1, 'Please type your password.'),
});

// A fixed hash to compare against when the email is unknown, so both cases take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || user.status !== 'ACTIVE') {
      throw new AppError(401, 'The email or password is not correct.');
    }
    startSession(res, user.id);
    await audit(prisma, user.id, 'login', 'user', user.id);
    res.json({ user: userJson(user) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

const passwordSchema = z.object({
  currentPassword: z.string({ required_error: 'Please type your current password.' }).min(1, 'Please type your current password.'),
  newPassword: z
    .string({ required_error: 'Please type a new password.' })
    .min(8, 'The new password must be at least 8 characters long.')
    .max(100),
});

// Any user can change their own password from "My Profile".
authRouter.post(
  '/change-password',
  requireUser,
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);
    const user = req.user!;
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AppError(400, 'The current password is not correct.');
    }
    if (currentPassword === newPassword) throw new AppError(400, 'The new password must be different from the current one.');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    await audit(prisma, user.id, 'user.change-password', 'user', user.id);
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireUser, (req, res) => {
  res.json({ user: userJson(req.user!) });
});
