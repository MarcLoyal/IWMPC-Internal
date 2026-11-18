import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { isDateString } from '../lib/dates';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { AUDIT_CATEGORIES, listAudit, type AuditCategory } from '../services/auditView';

export const auditRouter = Router();

const date = z
  .string()
  .refine(isDateString, 'Please choose a valid date.')
  .optional()
  .or(z.literal('').transform(() => undefined));
const id = z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined));

// Admin: read the log. There is no route that changes or deletes entries, and the database refuses it too.
auditRouter.get(
  '/',
  allow('ADMIN'),
  wrap(async (req, res) => {
    const q = z
      .object({
        from: date,
        to: date,
        userId: id,
        accountId: id,
        before: id,
        limit: z.coerce.number().int().min(1).max(200).optional(),
        category: z
          .enum(Object.keys(AUDIT_CATEGORIES) as [AuditCategory, ...AuditCategory[]])
          .optional()
          .or(z.literal('').transform(() => undefined)),
      })
      .parse(req.query);
    const [result, users] = await Promise.all([
      listAudit(q),
      prisma.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, status: true } }),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      ...result,
      users,
      categories: Object.entries(AUDIT_CATEGORIES).map(([key, c]) => ({ key, label: c.label })),
    });
  }),
);

// Any user: the screen reports when it refused to open a page for their role, so it is on record.
auditRouter.post(
  '/page-blocked',
  wrap(async (req, res) => {
    const { path } = z.object({ path: z.string().trim().min(1).max(200).startsWith('/') }).parse(req.body);
    await audit(prisma, req.user!.id, 'page.blocked', 'access', null, null, { path: path.split('?')[0], role: req.user!.role });
    res.json({ ok: true });
  }),
);
