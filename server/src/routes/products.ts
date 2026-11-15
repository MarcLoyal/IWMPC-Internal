import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';

/*
 * Products and their prices. Everyone who is logged in can SEE them.
 * Only an Admin can add, rename, stop selling, or change a price: every route that changes
 * anything has allow('ADMIN') on the server, whatever the screen shows.
 */
export const productsRouter = Router();

type UnitRow = Prisma.ProductUnitGetPayload<object>;

function unitJson(u: UnitRow) {
  return {
    id: u.id,
    label: u.label,
    price: u.price.toFixed(2),
    memberPrice: u.memberPrice?.toFixed(2) ?? null,
    active: u.active,
  };
}

function productJson(p: Prisma.ProductGetPayload<{ include: { units: true } }>) {
  return { id: p.id, name: p.name, active: p.active, units: p.units.map(unitJson) };
}

const include = { units: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] } };

productsRouter.get(
  '/',
  wrap(async (req, res) => {
    // The Cashier only needs what is on sale; Settings asks for everything.
    const all = req.query.all === '1';
    const products = await prisma.product.findMany({
      where: all ? {} : { active: true },
      include: { units: { ...include.units, where: all ? {} : { active: true } } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json({ products: products.map(productJson) });
  }),
);

// Price history for one product, newest first.
productsRouter.get(
  '/:id/history',
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This product');
    const changes = await prisma.priceChange.findMany({
      where: { unit: { productId: id } },
      include: { unit: true, changedBy: { select: { name: true } } },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    });
    res.json({
      history: changes.map((c) => ({
        id: c.id,
        unit: c.unit.label,
        oldPrice: c.oldPrice?.toFixed(2) ?? null,
        newPrice: c.newPrice.toFixed(2),
        oldMemberPrice: c.oldMemberPrice?.toFixed(2) ?? null,
        newMemberPrice: c.newMemberPrice?.toFixed(2) ?? null,
        reason: c.reason,
        changedBy: c.changedBy?.name ?? null,
        changedAt: c.changedAt.toISOString(),
      })),
    });
  }),
);

const name = z.string({ required_error: 'Please type the product name.' }).trim().min(1, 'Please type the product name.').max(60);
const label = z
  .string({ required_error: 'Please type the unit, for example "per kilo".' })
  .trim()
  .min(1, 'Please type the unit, for example "per kilo".')
  .max(60);
const price = z.union([z.string(), z.number()], { errorMap: () => ({ message: 'Please enter the price.' }) }).transform((v, ctx) => {
  const parsed = parseMoney(String(v));
  if (!parsed) {
    ctx.addIssue({ code: 'custom', message: 'Please enter a valid price, for example 1250.00.' });
    return z.NEVER;
  }
  return parsed;
});
// Blank = members pay the same price.
const memberPrice = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const parsed = parseMoney(String(v));
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Please enter a valid member price, or leave it blank.' });
      return z.NEVER;
    }
    return parsed;
  });
const unitFields = { label, price, memberPrice };

async function assertNameFree(value: string, exceptId?: number) {
  const clash = await prisma.product.findFirst({
    where: { name: { equals: value, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
  });
  if (clash) throw new AppError(409, `There is already a product named ${clash.name}.`);
}

async function assertLabelFree(productId: number, value: string, exceptId?: number) {
  const clash = await prisma.productUnit.findFirst({
    where: { productId, label: { equals: value, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
  });
  if (clash) throw new AppError(409, `This product already has the unit "${clash.label}".`);
}

function firstPrice(tx: Prisma.TransactionClient, unit: UnitRow, userId: number) {
  return tx.priceChange.create({
    data: {
      productUnitId: unit.id,
      oldPrice: null,
      newPrice: unit.price,
      oldMemberPrice: null,
      newMemberPrice: unit.memberPrice,
      reason: 'New item',
      changedById: userId,
    },
  });
}

// New product with its first unit and price.
productsRouter.post(
  '/',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const data = z.object({ name, ...unitFields }).parse(req.body);
    await assertNameFree(data.name);
    const product = await prisma.$transaction(async (tx) => {
      const last = await tx.product.aggregate({ _max: { sortOrder: true } });
      const created = await tx.product.create({
        data: {
          name: data.name,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          units: { create: [{ label: data.label, price: data.price, memberPrice: data.memberPrice }] },
        },
        include,
      });
      await firstPrice(tx, created.units[0], req.user!.id);
      await audit(tx, req.user!.id, 'product.create', 'product', created.id, null, created);
      return created;
    });
    res.status(201).json(productJson(product));
  }),
);

// Rename, or stop / resume selling. Past sales keep the name they were sold under.
productsRouter.put(
  '/:id',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This product');
    const data = z.object({ name, active: z.boolean() }).parse(req.body);
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) throw notFound('This product');
    await assertNameFree(data.name, id);
    const product = await prisma.product.update({ where: { id }, data, include });
    await audit(prisma, req.user!.id, 'product.update', 'product', id, before, product);
    res.json(productJson(product));
  }),
);

// Another unit for a product, e.g. "per sack (50 kg)".
productsRouter.post(
  '/:id/units',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This product');
    const data = z.object(unitFields).parse(req.body);
    if (!(await prisma.product.findUnique({ where: { id } }))) throw notFound('This product');
    await assertLabelFree(id, data.label);
    const unit = await prisma.$transaction(async (tx) => {
      const last = await tx.productUnit.aggregate({ where: { productId: id }, _max: { sortOrder: true } });
      const created = await tx.productUnit.create({
        data: { productId: id, label: data.label, price: data.price, memberPrice: data.memberPrice, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      await firstPrice(tx, created, req.user!.id);
      await audit(tx, req.user!.id, 'product-unit.create', 'product_unit', created.id, null, created);
      return created;
    });
    res.status(201).json(unitJson(unit));
  }),
);

// Rename a unit, or stop / resume selling it. This never changes a price.
productsRouter.put(
  '/units/:unitId',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const unitId = idParam(req.params.unitId, 'This unit');
    const data = z.object({ label, active: z.boolean() }).parse(req.body);
    const before = await prisma.productUnit.findUnique({ where: { id: unitId } });
    if (!before) throw notFound('This unit');
    await assertLabelFree(before.productId, data.label, unitId);
    const unit = await prisma.productUnit.update({ where: { id: unitId }, data });
    await audit(prisma, req.user!.id, 'product-unit.update', 'product_unit', unitId, before, unit);
    res.json(unitJson(unit));
  }),
);

// Change a price. Needs a reason, and is written to the price history. Sales already made
// carry their own copy of the price, so they are not affected.
productsRouter.post(
  '/units/:unitId/price',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const unitId = idParam(req.params.unitId, 'This unit');
    const data = z
      .object({
        price,
        memberPrice,
        reason: z
          .string({ required_error: 'Please type a short reason for the price change.' })
          .trim()
          .min(1, 'Please type a short reason for the price change.')
          .max(200),
      })
      .parse(req.body);
    const before = await prisma.productUnit.findUnique({ where: { id: unitId } });
    if (!before) throw notFound('This unit');
    const samePrice = before.price.equals(data.price);
    const sameMember =
      (before.memberPrice === null && data.memberPrice === null) ||
      (before.memberPrice !== null && data.memberPrice !== null && before.memberPrice.equals(data.memberPrice));
    if (samePrice && sameMember) throw new AppError(400, 'The price is the same as before. Nothing was changed.');

    const unit = await prisma.$transaction(async (tx) => {
      const updated = await tx.productUnit.update({ where: { id: unitId }, data: { price: data.price, memberPrice: data.memberPrice } });
      await tx.priceChange.create({
        data: {
          productUnitId: unitId,
          oldPrice: before.price,
          newPrice: data.price,
          oldMemberPrice: before.memberPrice,
          newMemberPrice: data.memberPrice,
          reason: data.reason,
          changedById: req.user!.id,
        },
      });
      await audit(tx, req.user!.id, 'price.change', 'product_unit', unitId, before, { ...updated, reason: data.reason });
      return updated;
    });
    res.json(unitJson(unit));
  }),
);
