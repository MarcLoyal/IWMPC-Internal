import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { parseMoney } from '../lib/money';
import { idParam } from '../lib/params';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { formatNumber } from '../services/numbering';
import { MONEY_SETTINGS, SETTING_KEYS, getSettings, type SettingKey } from '../services/settings';

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
    water_due_rule: z.enum(['DAY_OF_NEXT_MONTH', 'DAYS_AFTER_READING'], { errorMap: () => ({ message: 'Please choose how the due date is set.' }) }),
    water_due_day: wholeNumber('the due day of the month', 1, 28),
    coop_phone: text(60),
    coop_mobile: text(60),
    bill_paper: z.enum(['LETTER', 'LONG'], { errorMap: () => ({ message: 'Please choose the paper size.' }) }),
    bill_preparer_name: text(80),
    bill_preparer_title: text(60),
    bill_cashier_name: text(80),
    bill_cashier_title: text(60),
    bill_manager_name: text(80),
    bill_manager_title: text(60),
    ...Object.fromEntries(
      ['bill', 'notice'].flatMap((form) =>
        ['preparer', 'cashier', 'manager'].map((who) => [`sig_${form}_${who}_on`, z.enum(['true', 'false'])]),
      ),
    ),
    notice_phone_line: text(120),
    notice_preparer_name: text(80),
    notice_preparer_title: text(60),
    notice_cashier_name: text(80),
    notice_cashier_title: text(60),
    notice_manager_name: text(80),
    notice_manager_title: text(60),
    notice_threshold_months: wholeNumber('the number of unpaid months', 2, 12),
    notice_per_page: z.enum(['1', '2'], { errorMap: () => ({ message: 'Please choose 1 or 2 notices per page.' }) }),
    disconnect_days_after_due: wholeNumber('the days before disconnection', 0, 90),
    reconnection_fee: money('reconnection fee'),
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
    invoice_atp_no: text(60),
    invoice_atp_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose the date the ATP was issued.')]),
    invoice_series_from: wholeNumber('the first invoice number', 1, 999999999),
    invoice_series_to: wholeNumber('the last invoice number', 1, 999999999),
    invoice_tin_line: text(120),
    invoice_phone_line: text(120),
  })
  .partial();

settingsRouter.put(
  '/',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const changes = settingsSchema.parse(req.body) as Partial<Record<SettingKey, string>>;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    const before = await getSettings(prisma);
    // "10" and "10.00" are the same amount, so saving it again is not a change.
    const same = (a: string | undefined, b: string | undefined) =>
      a === b || (a !== undefined && b !== undefined && a.trim() !== '' && b.trim() !== '' && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b));
    const changed = (Object.keys(changes) as SettingKey[]).filter((k) => !same(changes[k], before[k]));
    const from = Number(changes.invoice_series_from ?? before.invoice_series_from);
    const to = Number(changes.invoice_series_to ?? before.invoice_series_to);
    if (from > to) throw new AppError(400, 'The first invoice number must be smaller than the last one.');
    if (changed.some((k) => MONEY_SETTINGS.includes(k)) && !reason) {
      throw new AppError(400, 'Please type a short reason for changing the penalty or the reconnection fee.');
    }
    await prisma.$transaction(async (tx) => {
      for (const key of changed) {
        const value = changes[key]!;
        await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
        await tx.settingChange.create({
          data: { key, oldValue: before[key] ?? null, newValue: value, reason, changedById: req.user!.id },
        });
      }
      await audit(tx, req.user!.id, 'settings.update', 'settings', null, before, { ...before, ...changes, reason });
    });
    res.json({ ok: true });
  }),
);

// The history of chosen settings, newest first (Admin only).
settingsRouter.get(
  '/history',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const keys = String(req.query.keys ?? '')
      .split(',')
      .filter((k): k is SettingKey => (SETTING_KEYS as string[]).includes(k));
    const rows = await prisma.settingChange.findMany({
      where: keys.length ? { key: { in: keys } } : {},
      include: { changedBy: { select: { name: true } } },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json({
      history: rows.map((r) => ({
        id: r.id,
        key: r.key,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
        changedBy: r.changedBy?.name ?? null,
        changedAt: r.changedAt.toISOString(),
      })),
    });
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
