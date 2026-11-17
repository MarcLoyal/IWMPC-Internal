import { PNG } from 'pngjs';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { audit } from './audit';

/*
 * Signature images for printed bills. They are kept private:
 *  - stored in a private Supabase Storage bucket (or, when Supabase is not set up, in the database),
 *  - read only by this server with the service key, never through a public link,
 *  - sent to a browser only inside the print data, to be drawn into the PDF.
 */

export const SLOTS = ['bill_preparer', 'bill_cashier', 'bill_manager', 'notice_preparer', 'notice_cashier', 'notice_manager'] as const;
export type Slot = (typeof SLOTS)[number];
export const isSlot = (s: string): s is Slot => (SLOTS as readonly string[]).includes(s);

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const BUCKET = 'signatures';

// ---- Cleaning up the image ---------------------------------------------------------------------

/**
 * Makes a plain white (or light grey) background transparent and trims the empty edges, so only the
 * ink is printed. Pixels that are already transparent stay transparent.
 */
export function cleanSignature(input: Buffer): { png: Buffer; width: number; height: number } {
  let img: PNG;
  try {
    img = PNG.sync.read(input);
  } catch {
    throw new AppError(400, 'Please upload a PNG picture of the signature.');
  }
  const { width, height, data } = img;
  if (width < 20 || height < 10) throw new AppError(400, 'The picture is too small. Please upload a clearer picture of the signature.');
  if (width > 4000 || height > 4000) throw new AppError(400, 'The picture is too large. Please crop it to just the signature.');

  // Light pixels become see-through; slightly grey ones fade, so the edges of the ink stay smooth.
  const FULL = 235;
  const EDGE = 200;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (light >= FULL) data[i + 3] = 0;
      else if (light > EDGE) data[i + 3] = Math.min(data[i + 3], Math.round((255 * (FULL - light)) / (FULL - EDGE)));
      if (data[i + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new AppError(400, 'No signature was found in the picture. Please upload a picture with the signature in dark ink.');

  const pad = 4;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const w = Math.min(width, maxX + pad + 1) - x0;
  const h = Math.min(height, maxY + pad + 1) - y0;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, x0, y0, w, h, 0, 0);
  return { png: PNG.sync.write(out), width: w, height: h };
}

// ---- Private storage ---------------------------------------------------------------------------

const supabase = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  // Either the new secret key (sb_secret_...) or the legacy service_role key.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
};

/**
 * How the key is sent. A new secret key (sb_secret_...) is not a JWT: it goes only in the `apikey`
 * header and Supabase's gateway turns it into a service-role token. A legacy service_role key is a JWT
 * and also goes in `Authorization: Bearer`.
 */
export function storageHeaders(key: string): Record<string, string> {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

async function storageFetch(path: string, init: RequestInit = {}) {
  const s = supabase()!;
  return fetch(`${s.url}/storage/v1/${path}`, {
    ...init,
    headers: { ...storageHeaders(s.key), ...(init.headers ?? {}) },
  });
}

let bucketReady = false;
/** Creates the private bucket the first time it is needed. */
async function ensureBucket() {
  if (bucketReady) return;
  const res = await storageFetch('bucket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_UPLOAD_BYTES, allowed_mime_types: ['image/png'] }),
  });
  // "Already exists" is fine.
  if (!res.ok && res.status !== 409 && res.status !== 400) throw new Error(`Could not prepare signature storage (${res.status})`);
  bucketReady = true;
}

export async function saveSignature(slot: Slot, raw: Buffer, userId: number) {
  if (raw.length > MAX_UPLOAD_BYTES) throw new AppError(400, 'The picture is too large. Please use a picture under 2 MB.');
  const { png, width, height } = cleanSignature(raw);
  const before = await prisma.signatureImage.findUnique({ where: { slot } });
  const key = `${slot}.png`;
  let storage = 'DATABASE';
  let data: Uint8Array<ArrayBuffer> | null = new Uint8Array(png);
  if (supabase()) {
    await ensureBucket();
    const res = await storageFetch(`object/${BUCKET}/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'x-upsert': 'true', 'Cache-Control': 'no-store' },
      body: new Uint8Array(png),
    });
    if (!res.ok) throw new AppError(502, 'The signature could not be saved. Please try again.');
    storage = 'SUPABASE';
    data = null;
  }
  await prisma.signatureImage.upsert({
    where: { slot },
    update: { storage, storageKey: key, data, width, height, updatedById: userId },
    create: { slot, storage, storageKey: key, data, width, height, updatedById: userId },
  });
  await audit(prisma, userId, before ? 'signature.replace' : 'signature.upload', 'signature', slot, before ? { width: before.width, height: before.height } : null, { width, height, storage });
  return { width, height };
}

export async function removeSignature(slot: Slot, userId: number) {
  const before = await prisma.signatureImage.findUnique({ where: { slot } });
  if (!before) throw new AppError(404, 'There is no signature to remove.');
  if (before.storage === 'SUPABASE' && supabase()) {
    await storageFetch(`object/${BUCKET}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [before.storageKey] }),
    });
  }
  await prisma.signatureImage.delete({ where: { slot } });
  await audit(prisma, userId, 'signature.remove', 'signature', slot, { width: before.width, height: before.height }, null);
}

/** The image bytes, read privately by the server. */
export async function readSignature(slot: Slot): Promise<Buffer | null> {
  const row = await prisma.signatureImage.findUnique({ where: { slot } });
  if (!row) return null;
  if (row.data) return Buffer.from(row.data);
  if (row.storage === 'SUPABASE' && supabase()) {
    const res = await storageFetch(`object/${BUCKET}/${row.storageKey}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

/** The signatures to draw on a form, keyed by slot, only for signatories with "Print signature" on. */
export async function signaturesFor(form: 'bill' | 'notice', settings: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const who of ['preparer', 'cashier', 'manager']) {
    const slot = `${form}_${who}` as Slot;
    if (settings[`sig_${slot}_on`] !== 'true') continue;
    const bytes = await readSignature(slot);
    if (bytes) out[who] = bytes.toString('base64');
  }
  return out;
}
