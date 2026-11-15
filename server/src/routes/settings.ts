import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { formatNumber } from '../services/numbering';
import { getSettings, type SettingKey } from '../services/settings';

export const settingsRouter = Router();
export const areasRouter = Router();

// Everyone can read settings (the cashier needs the fees; printouts need the coop name).
settingsRouter.get(
  '/',
  wrap(async (_req, res) => {
    const s = await getSettings(prisma);
    res.json({
      ...s,
      nextAccountNumber: formatNumber(s.account_no_prefix, Number(s.account_no_padding), Number(s.account_no_next)),
      nextMemberNumber: formatNumber(s.member_no_prefix, Number(s.member_no_padding), Number(s.member_no_next)),
    });
  }),
);

const text = (max: number) => z.string().trim().max(max);
const money = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const parsed = parseMoney(String(v));
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: `Please enter a valid amount for the ${label}.` });
      return z.NEVER;
    }
    return parsed.toFixed(2);
  });
const wholeNumber = (label: string, min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: `Please enter a number for ${label}.` })
    .int(`Please enter a whole number for ${label}.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`)
    .transform(String);

const settingsSchema = z
  .object({
    coop_name: text(150).min(1, 'Please type the cooperative name.'),
    coop_address: text(250),
    coop_cda_no: text(80),
    membership_fee: money('membership fee'),
    installation_fee: money('installation fee'),
    water_due_days: wholeNumber('the days until the due date', 0, 90),
    water_penalty_type: z.enum(['PERCENT', 'FIXED'], { errorMap: () => ({ message: 'Please choose the kind of late penalty.' }) }),
    water_penalty_value: money('late penalty'),
    water_disconnect_months: wholeNumber('the number of unpaid months', 1, 24),
    allow_credit: z.enum(['true', 'false'], { errorMap: () => ({ message: 'Please choose Yes or No for credit sales.' }) }),
    account_no_prefix: text(10),
    account_no_padding: wholeNumber('the number of digits', 1, 10),
    account_no_next: wholeNumber('the next account number', 1, 999999999),
    member_no_prefix: text(10),
    member_no_padding: wholeNumber('the number of digits', 1, 10),
    member_no_next: wholeNumber('the next member number', 1, 999999999),
  })
  .partial();

settingsRouter.put(
  '/',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const changes = settingsSchema.parse(req.body) as Partial<Record<SettingKey, string>>;
    const before = await getSettings(prisma);
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(changes)) {
        await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
      }
      await audit(tx, req.user!.id, 'settings.update', 'settings', null, before, { ...before, ...changes });
    });
    res.json({ ok: true });
  }),
);

areasRouter.get(
  '/',
  wrap(async (_req, res) => {
    const areas = await prisma.area.findMany({ orderBy: { id: 'asc' } });
    res.json({ areas });
  }),
);

const areaSchema = z.object({
  name: z.string({ required_error: 'Please type the area name.' }).trim().min(1, 'Please type the area name.').max(80),
});

async function assertAreaNameFree(name: string, exceptId?: number) {
  const clash = await prisma.area.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
  });
  if (clash) throw new AppError(409, `There is already an area named ${clash.name}.`);
}

areasRouter.post(
  '/',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const { name } = areaSchema.parse(req.body);
    await assertAreaNameFree(name);
    const area = await prisma.area.create({ data: { name } });
    await audit(prisma, req.user!.id, 'area.create', 'area', area.id, null, area);
    res.status(201).json(area);
  }),
);

areasRouter.put(
  '/:id',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'This area');
    const { name } = areaSchema.parse(req.body);
    const before = await prisma.area.findUnique({ where: { id } });
    if (!before) throw notFound('This area');
    await assertAreaNameFree(name, id);
    const area = await prisma.area.update({ where: { id }, data: { name } });
    await audit(prisma, req.user!.id, 'area.rename', 'area', id, before, area);
    res.json(area);
  }),
);
