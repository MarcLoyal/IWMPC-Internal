import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { allow, allowWork, wrap } from '../middleware/auth';
import { cancelInvoiceTx } from '../services/payments';
import { checkNumber, createInvoice, invoiceGuide, invoiceSeries, previewGuide, suggestNumber, type InvoiceItem, type NewInvoice } from '../services/invoices';

export const invoicesRouter = Router();

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const parsed = parseMoney(String(v));
  if (!parsed || parsed.lte(0)) {
    ctx.addIssue({ code: 'custom', message: 'Please enter a valid amount, for example 1250.00.' });
    return z.NEVER;
  }
  return parsed;
});
const quantity = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const text = String(v).replace(/,/g, '').trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Please enter a valid quantity, for example 1 or 2.5.' });
    return z.NEVER;
  }
  return new Prisma.Decimal(text);
});

const item = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WATER_BILL'), waterBillId: z.coerce.number().int().positive().nullable().default(null), amount: money }),
  z.object({ type: z.enum(['INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'SHARE_CAPITAL']), amount: money }),
  z.object({ type: z.literal('OTHER'), amount: money, description: z.string().trim().max(200).default('') }),
  z.object({ type: z.literal('RICE_LPG'), saleId: z.coerce.number().int().positive(), amount: money }),
  z.object({ type: z.literal('SALE'), items: z.array(z.object({ unitId: z.coerce.number().int().positive(), quantity })).min(1).max(30) }),
]);

const invoiceSchema = z.object({
  accountId: z.coerce.number().int().positive().nullable().default(null),
  walkInName: z.string().trim().max(120).default(''),
  number: z.string().trim().max(30, 'The Invoice No. is too long.').default(''),
  credit: z.boolean().default(false),
  items: z.array(item, { errorMap: () => ({ message: 'Please add at least one item to the invoice.' }) }).min(1, 'Please add at least one item to the invoice.').max(40),
});

const parse = (body: unknown): NewInvoice => {
  const d = invoiceSchema.parse(body);
  return { ...d, items: d.items as InvoiceItem[] };
};

const cashier = allowWork('CASHIER');

// The next number for this cashier (their last + 1) and the booklet series.
invoicesRouter.get(
  '/suggest',
  cashier,
  wrap(async (req, res) => {
    res.json({ next: await suggestNumber(req.user!.id), series: await invoiceSeries() });
  }),
);

// Is this number free, and inside the approved series?
invoicesRouter.get(
  '/check',
  cashier,
  wrap(async (req, res) => {
    res.json(await checkNumber(typeof req.query.number === 'string' ? req.query.number : ''));
  }),
);

// "Review Payment": the guide for an invoice that is not saved yet. Nothing is recorded.
invoicesRouter.post(
  '/preview',
  cashier,
  wrap(async (req, res) => {
    const input = parse(req.body);
    res.json({ guide: await previewGuide(input), check: await checkNumber(input.number) });
  }),
);

// "Yes, Save Payment": saves the invoice and all its payments together.
invoicesRouter.post(
  '/',
  cashier,
  wrap(async (req, res) => {
    const { invoice } = await createInvoice(parse(req.body), req.user!.id);
    res.status(201).json({ invoice: { id: invoice.id, number: invoice.number }, guide: await invoiceGuide(invoice.id) });
  }),
);

// Find an invoice by its number.
invoicesRouter.get(
  '/',
  wrap(async (req, res) => {
    const number = typeof req.query.number === 'string' ? req.query.number.trim().toUpperCase() : '';
    if (!number) throw new AppError(400, 'Please type an Invoice No. to search for.');
    const invoice = await prisma.invoice.findUnique({ where: { number } });
    res.json({ invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status } : null });
  }),
);

// The guide for a saved invoice (view only).
invoicesRouter.get(
  '/:id/guide',
  wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ guide: await invoiceGuide(idParam(req.params.id, 'This invoice')) });
  }),
);

// Admin: cancel the whole invoice (all its payments). The number is never used again.
invoicesRouter.post(
  '/:id/cancel',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const { reason } = z
      .object({ reason: z.string({ required_error: 'Please type the reason for cancelling this invoice.' }).trim().min(1, 'Please type the reason for cancelling this invoice.').max(300) })
      .parse(req.body);
    const id = idParam(req.params.id, 'This invoice');
    await prisma.$transaction((tx) => cancelInvoiceTx(tx, id, reason, req.user!.id));
    res.json({ guide: await invoiceGuide(id) });
  }),
);
