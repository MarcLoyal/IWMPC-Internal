import { Router } from 'express';
import { z } from 'zod';
import { allow, wrap } from '../middleware/auth';
import { goLivePreview, runGoLive } from '../services/goLive';

export const goLiveRouter = Router();
goLiveRouter.use(allow('ADMIN'));

// What the cleanup would remove and keep. Changes nothing.
goLiveRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await goLivePreview());
  }),
);

// Admin, once ever: remove the demo data and start the Audit Log fresh.
goLiveRouter.post(
  '/',
  wrap(async (req, res) => {
    const input = z
      .object({
        keepUserIds: z.array(z.number().int().positive()).max(200).default([]),
        alsoRemoveOthers: z.boolean().default(false),
        confirm: z.string().default(''),
      })
      .parse(req.body);
    res.json(await runGoLive(input, req.user!.id));
  }),
);
