import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { audit } from './audit';

/**
 * The one-time go-live cleanup: removes the demo data so the client starts clean, then locks
 * itself for good. Every table in the database must be listed below, in CLEARED or KEPT, so a
 * new table can never be forgotten (a test checks this).
 */

/** Emptied: demo records and their history. The order does not matter; they are emptied together. */
export const CLEARED_TABLES = [
  'audit_log',
  'access_grants',
  'payments',
  'invoices',
  'sale_items',
  'sales',
  'bill_prints',
  'water_bills',
  'meter_readings',
  'beneficiaries',
  'water_connections',
  'accounts',
  'price_changes',
  'setting_changes',
] as const;

/** Kept: the setup the client needs. Users are kept only if the Admin chooses them. */
export const KEPT_TABLES = ['areas', 'settings', 'rate_schedules', 'products', 'product_units', 'signature_images', 'users', '_prisma_migrations'] as const;

/** The logins the sample data uses. Anything they entered is demo data. */
export const isDemoEmail = (email: string) => email.toLowerCase().endsWith('@iwmpc.test');

export const GO_LIVE_ACTION = 'system.go-live';
export const CONFIRM_WORDS = 'GO LIVE';

const COUNTED = {
  accounts: 'Accounts',
  waterConnections: 'Water connections',
  meterReadings: 'Meter readings and bills',
  payments: 'Payments',
  invoices: 'Service invoices',
  sales: 'Rice & LPG sales',
  auditLog: 'Audit Log entries',
} as const;

async function counts(db: Prisma.TransactionClient | typeof prisma) {
  const [accounts, waterConnections, meterReadings, payments, invoices, sales, auditLog] = await Promise.all([
    db.account.count(),
    db.waterConnection.count(),
    db.meterReading.count(),
    db.payment.count(),
    db.invoice.count(),
    db.sale.count(),
    db.auditLog.count(),
  ]);
  const n = { accounts, waterConnections, meterReadings, payments, invoices, sales, auditLog };
  return (Object.keys(COUNTED) as (keyof typeof COUNTED)[]).map((key) => ({ key, label: COUNTED[key], count: n[key] }));
}

/** Records entered by logins that are not demo logins: these might be real, so they are listed. */
async function notDemo(db: Prisma.TransactionClient | typeof prisma) {
  const others = await db.user.findMany({ select: { id: true, name: true, email: true } });
  const real = others.filter((u) => !isDemoEmail(u.email));
  const rows = await Promise.all(
    real.map(async (u) => {
      const [accounts, readings, payments, invoices, sales] = await Promise.all([
        db.account.count({ where: { createdById: u.id } }),
        db.meterReading.count({ where: { enteredById: u.id } }),
        db.payment.count({ where: { createdById: u.id } }),
        db.invoice.count({ where: { createdById: u.id } }),
        db.sale.count({ where: { createdById: u.id } }),
      ]);
      return { user: u, accounts, readings, payments, invoices, sales, total: accounts + readings + payments + invoices + sales };
    }),
  );
  return rows.filter((r) => r.total > 0);
}

/** Who ran the cleanup and when, if it has been run. */
export async function goLiveDone() {
  const entry = await prisma.auditLog.findFirst({ where: { action: GO_LIVE_ACTION }, include: { user: { select: { name: true } } } });
  return entry ? { at: entry.createdAt.toISOString(), by: entry.user?.name ?? null } : null;
}

/** What the cleanup would remove and keep, without changing anything. */
export async function goLivePreview() {
  const done = await goLiveDone();
  const users = await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }], select: { id: true, name: true, email: true, role: true, status: true } });
  return {
    done,
    confirmWords: CONFIRM_WORDS,
    remove: await counts(prisma),
    users: users.map((u) => ({ ...u, demo: isDemoEmail(u.email) })),
    notDemo: await notDemo(prisma),
  };
}

export interface GoLiveInput {
  keepUserIds: number[];
  /** The Admin has checked that records entered by non-demo logins were tests too. */
  alsoRemoveOthers: boolean;
  confirm: string;
}

export async function runGoLive(input: GoLiveInput, adminId: number) {
  if (input.confirm.trim().toUpperCase() !== CONFIRM_WORDS) throw new AppError(400, `Please type ${CONFIRM_WORDS} to confirm.`);
  const keep = new Set([...input.keepUserIds, adminId]);

  return prisma.$transaction(
    async (tx) => {
      // One cleanup at a time; a second click waits here, then finds the first one done.
      await tx.$executeRawUnsafe('LOCK TABLE audit_log IN EXCLUSIVE MODE');
      if (await tx.auditLog.findFirst({ where: { action: GO_LIVE_ACTION } })) {
        throw new AppError(409, 'The go-live cleanup was already done. It can only be done once.');
      }

      const users = await tx.user.findMany();
      const kept = users.filter((u) => keep.has(u.id));
      if (kept.some((u) => isDemoEmail(u.email))) throw new AppError(400, 'Demo logins (@iwmpc.test) cannot be kept. Make a real login for each person first.');
      if (!kept.some((u) => u.role === 'ADMIN' && u.status === 'ACTIVE')) throw new AppError(400, 'Keep at least one active Admin, or nobody could log in.');

      const others = await notDemo(tx);
      if (others.length && !input.alsoRemoveOthers) {
        throw new AppError(409, 'Some records were entered by logins that are not demo logins. Check that they were tests, then confirm to remove them too.');
      }

      const removed = await counts(tx);
      // Asks the database for its one-time permission to empty the audit log (see the migration).
      await tx.$executeRawUnsafe("SELECT set_config('iwmpc.go_live_cleanup', 'on', true)");
      await tx.$executeRawUnsafe(`TRUNCATE ${CLEARED_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
      await tx.setting.updateMany({ where: { key: { in: ['account_no_next', 'member_no_next'] } }, data: { value: '1' } });
      const gone = users.filter((u) => !keep.has(u.id));
      await tx.user.deleteMany({ where: { id: { in: gone.map((u) => u.id) } } });

      // The first entry of the new log.
      await audit(tx, adminId, GO_LIVE_ACTION, 'system', null, null, {
        removed: Object.fromEntries(removed.map((r) => [r.label, r.count])),
        removedLogins: gone.map((u) => u.email),
        keptLogins: kept.map((u) => u.email),
        alsoRemovedOthers: others.length > 0,
      });
      return { removed, removedLogins: gone.length, keptLogins: kept.length };
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}
