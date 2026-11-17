import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { allow, wrap } from '../middleware/auth';
import { audit } from '../services/audit';
import { MAX_UPLOAD_BYTES, SLOTS, isSlot, readSignature, removeSignature, saveSignature } from '../services/signatures';
import { getSettings } from '../services/settings';

/* Signature images for printed bills. Admin only, on the server, for every route. */
export const signaturesRouter = Router();
signaturesRouter.use(allow('ADMIN'));

function slotParam(value: string) {
  if (!isSlot(value)) throw new AppError(404, 'This signature was not found.');
  return value;
}

signaturesRouter.get(
  '/',
  wrap(async (_req, res) => {
    const [rows, settings] = await Promise.all([
      prisma.signatureImage.findMany({ include: { updatedBy: { select: { name: true } } } }),
      getSettings(prisma),
    ]);
    res.json({
      signatures: SLOTS.map((slot) => {
        const row = rows.find((r) => r.slot === slot);
        return {
          slot,
          print: (settings as Record<string, string>)[`sig_${slot}_on`] === 'true',
          hasImage: !!row,
          updatedAt: row?.updatedAt.toISOString() ?? null,
          updatedBy: row?.updatedBy?.name ?? null,
        };
      }),
    });
  }),
);

// A small preview for the Admin in Settings. Not cached, not offered as a download.
signaturesRouter.get(
  '/:slot/preview',
  wrap(async (req, res) => {
    const bytes = await readSignature(slotParam(req.params.slot));
    if (!bytes) throw new AppError(404, 'There is no signature yet.');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline' });
    res.send(bytes);
  }),
);

signaturesRouter.put(
  '/:slot',
  express.raw({ type: ['image/png', 'application/octet-stream'], limit: MAX_UPLOAD_BYTES + 1024 }),
  wrap(async (req, res) => {
    const slot = slotParam(req.params.slot);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError(400, 'Please choose a PNG picture of the signature.');
    res.json(await saveSignature(slot, req.body, req.user!.id));
  }),
);

signaturesRouter.delete(
  '/:slot',
  wrap(async (req, res) => {
    await removeSignature(slotParam(req.params.slot), req.user!.id);
    res.json({ ok: true });
  }),
);

// The "Print signature" checkbox.
signaturesRouter.put(
  '/:slot/print',
  wrap(async (req, res) => {
    const slot = slotParam(req.params.slot);
    const { print } = z.object({ print: z.boolean() }).parse(req.body);
    const key = `sig_${slot}_on`;
    const before = await prisma.setting.findUnique({ where: { key } });
    const value = print ? 'true' : 'false';
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    if (before?.value !== value) {
      await prisma.settingChange.create({ data: { key, oldValue: before?.value ?? null, newValue: value, changedById: req.user!.id } });
    }
    await audit(prisma, req.user!.id, print ? 'signature.print-on' : 'signature.print-off', 'signature', slot, { print: before?.value === 'true' }, { print });
    res.json({ ok: true });
  }),
);
