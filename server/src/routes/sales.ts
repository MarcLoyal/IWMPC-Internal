import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { fromDbDate, isDateString, toDbDate, todayManila } from '../lib/dates';
import { idParam } from '../lib/params';
import { paymentJson, saleItemJson } from '../lib/serialize';
import { allow, wrap } from '../middleware/auth';
import { getSettings } from '../services/settings';
import { WALK_IN, createSale, voidCreditSale } from '../services/sales';
import { people } from './payments';

export const salesRouter = Router();

const quantity = z.union([z.string(), z.number()], { errorMap: () => ({ message: 'Please enter the quantity.' }) }).transform((v, ctx) => {
  const text = String(v).replace(/,/g, '').trim();
  // Up to two decimals, so 2.5 kilos works.
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Please enter a valid quantity, for example 1 or 2.5.' });
    return z.NEVER;
  }
  return new Prisma.Decimal(text);
});

const saleSchema = z.object({
  accountId: z.coerce.number().int().positive().nullable().optional(),
  walkInName: z.string().trim().max(120).default(''),
  items: z
    .array(z.object({ unitId: z.coerce.number().int().positive(), quantity }))
    .min(1, 'Please add at least one item to the sale.')
    .max(30),
  orNumber: z.string().trim().max(30, 'The OR number is too long.').default(''),
  credit: z.boolean().default(false),
});

// A new Rice & LPG sale: one or more items under one OR number.
salesRouter.post(
  '/',
  allow('ADMIN', 'CASHIER'),
  wrap(async (req, res) => {
    const data = saleSchema.parse(req.body);
    const { sale, payment } = await createSale({ ...data, accountId: data.accountId ?? null }, req.user!.id);
    const full = payment ? await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: people }) : null;
    res.status(201).json({
      saleId: sale.id,
      total: sale.total.toFixed(2),
      isCredit: sale.isCredit,
      items: sale.items.map(saleItemJson),
      payment: full ? paymentJson(full) : null,
    });
  }),
);

// Void a credit sale that has no payments. (A cash sale is voided by voiding its payment.)
salesRouter.post(
  '/:id/void',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const reason = z.object({ reason: z.string().trim().min(1, 'Please type the reason for voiding this sale.').max(300) }).parse(req.body).reason;
    await voidCreditSale(idParam(req.params.id, 'This sale'), reason, req.user!.id);
    res.json({ ok: true });
  }),
);

// Rice & LPG Sales report: totals per product and unit for a date range, plus every sale line.
salesRouter.get(
  '/report',
  wrap(async (req, res) => {
    const today = todayManila();
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : `${today.slice(0, 8)}01`;
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : today;
    if (!isDateString(from) || !isDateString(to)) throw new AppError(400, 'Please choose valid dates.');
    if (from > to) throw new AppError(400, 'The "from" date must be on or before the "to" date.');
    const productId = Number(req.query.productId) || null;
    // "All rice", "LPG": every product of that kind.
    const kind = req.query.category === 'RICE' || req.query.category === 'LPG' || req.query.category === 'OTHER' ? req.query.category : null;

    const [items, products, settings] = await Promise.all([
      prisma.saleItem.findMany({
        where: {
          sale: { status: 'ACTIVE', saleDate: { gte: toDbDate(from), lte: toDbDate(to) } },
          unit: productId ? { productId } : kind ? { product: { category: kind } } : undefined,
        },
        include: {
          unit: { select: { productId: true, product: { select: { category: true } } } },
          sale: {
            include: {
              account: { select: { id: true, fullName: true } },
              payments: { where: { status: 'ACTIVE' }, select: { orNumber: true } },
            },
          },
        },
        orderBy: [{ sale: { saleDate: 'asc' } }, { saleId: 'asc' }, { id: 'asc' }],
      }),
      prisma.product.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      getSettings(prisma),
    ]);

    // Grouped by the names as they were at the time of sale.
    const zero = new Prisma.Decimal(0);
    const groups = new Map<string, { productId: number; product: string; unit: string; quantity: Prisma.Decimal; amount: Prisma.Decimal; sales: Set<number> }>();
    let total = zero;
    let credit = zero;
    const byKind: Record<string, Prisma.Decimal> = {};
    for (const item of items) {
      const key = `${item.productName}|${item.unitLabel}`;
      const g = groups.get(key) ?? { productId: item.unit.productId, product: item.productName, unit: item.unitLabel, quantity: zero, amount: zero, sales: new Set<number>() };
      g.quantity = g.quantity.plus(item.quantity);
      g.amount = g.amount.plus(item.amount);
      g.sales.add(item.saleId);
      groups.set(key, g);
      total = total.plus(item.amount);
      byKind[item.unit.product.category] = (byKind[item.unit.product.category] ?? zero).plus(item.amount);
      if (item.sale.isCredit) credit = credit.plus(item.amount);
    }
    const order = new Map(products.map((p, i) => [p.id, i]));

    res.json({
      from,
      to,
      products: products.map((p) => ({ id: p.id, name: p.name, category: p.category })),
      totalsByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.toFixed(2)])),
      coop: { name: settings.coop_name, address: settings.coop_address, cdaNo: settings.coop_cda_no },
      summary: [...groups.values()]
        .sort((a, b) => (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0) || a.unit.localeCompare(b.unit))
        .map((g) => ({
          product: g.product,
          unit: g.unit,
          quantity: g.quantity.toDecimalPlaces(2).toString(),
          amount: g.amount.toFixed(2),
          sales: g.sales.size,
        })),
      total: total.toFixed(2),
      creditTotal: credit.toFixed(2),
      saleCount: new Set(items.map((i) => i.saleId)).size,
      lines: items.map((i) => ({
        ...saleItemJson(i),
        category: i.unit.product.category,
        saleId: i.saleId,
        date: fromDbDate(i.sale.saleDate)!,
        accountId: i.sale.accountId,
        buyer: i.sale.account?.fullName ?? (i.sale.walkInName || WALK_IN),
        walkIn: i.sale.accountId === null,
        isCredit: i.sale.isCredit,
        orNumbers: i.sale.payments.map((p) => p.orNumber),
      })),
    });
  }),
);
