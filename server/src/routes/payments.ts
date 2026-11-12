import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { parseMoney } from '../lib/money';
import { normalizeOr } from '../lib/orNumbers';
import { idParam } from '../lib/params';
import { paymentJson } from '../lib/serialize';
import { allow, wrap } from '../middleware/auth';
import { recordPayment, voidPayment } from '../services/payments';

export const paymentsRouter = Router();

const people = {
  account: { select: { id: true, fullName: true, accountNumber: true } },
  createdBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
} as const;

const paymentSchema = z.object({
  accountId: z.coerce.number({ invalid_type_error: 'Please pick an account.' }).int().positive('Please pick an account.'),
  type: z.enum(['INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'SHARE_CAPITAL', 'OTHER'], {
    errorMap: () => ({ message: 'Please pick the payment type.' }),
  }),
  amount: z.union([z.string(), z.number()], { errorMap: () => ({ message: 'Please enter the amount.' }) }).transform(String),
  orNumber: z
    .string({ required_error: 'Please enter the OR number from the receipt booklet.' })
    .trim()
    .min(1, 'Please enter the OR number from the receipt booklet.')
    .max(30, 'The OR number is too long.'),
  description: z.string().trim().max(200).default(''),
});

paymentsRouter.post(
  '/',
  allow('ADMIN', 'CASHIER'),
  wrap(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    const amount = parseMoney(data.amount);
    if (!amount) throw new AppError(400, 'Please enter a valid amount, for example 1250.00.');
    const payment = await recordPayment({ ...data, amount }, req.user!.id);
    const full = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: people });
    res.status(201).json(paymentJson(full));
  }),
);

// Look up a payment by its OR number.
paymentsRouter.get(
  '/',
  wrap(async (req, res) => {
    const or = typeof req.query.or === 'string' ? normalizeOr(req.query.or) : '';
    if (!or) throw new AppError(400, 'Please type an OR number to search for.');
    const payment = await prisma.payment.findUnique({ where: { orNumber: or }, include: people });
    res.json({ payment: payment ? paymentJson(payment) : null });
  }),
);

paymentsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: idParam(req.params.id, 'This payment') },
      include: people,
    });
    if (!payment) throw notFound('This payment');
    res.json(paymentJson(payment));
  }),
);

const voidSchema = z.object({
  reason: z
    .string({ required_error: 'Please type the reason for voiding this payment.' })
    .trim()
    .min(1, 'Please type the reason for voiding this payment.')
    .max(300),
});

paymentsRouter.post(
  '/:id/void',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This payment');
    const { reason } = voidSchema.parse(req.body);
    await voidPayment(id, reason, req.user!.id);
    const full = await prisma.payment.findUniqueOrThrow({ where: { id }, include: people });
    res.json(paymentJson(full));
  }),
);
