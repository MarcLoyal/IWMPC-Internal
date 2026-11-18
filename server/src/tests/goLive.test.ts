import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { CLEARED_TABLES, KEPT_TABLES } from '../services/goLive';
import { loginAs, makeAccount, resetDb } from './helpers';

beforeEach(resetDb);

const PASSWORD = 'demo-pass-123';

/** Demo logins like the sample data's, and a login for one of them. */
async function demoUsers() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 4);
  for (const [role, email] of [['CASHIER', 'cashier@iwmpc.test'], ['ADMIN', 'admin@iwmpc.test']] as const) {
    await prisma.user.create({ data: { name: `Demo ${role}`, email, role, passwordHash } });
  }
}
async function loginEmail(email: string) {
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}
const pay = (accountId: number, orNumber: string) => ({ accountId, type: 'OTHER', amount: '100.00', orNumber, description: 'Fee' });
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

/** Demo data entered only by demo logins, the way the sample data is. */
async function demoData() {
  await demoUsers();
  const account = await makeAccount('Juan Dela Cruz', 'ACTIVE');
  const cashier = await loginEmail('cashier@iwmpc.test');
  expect((await cashier.post('/api/payments').send(pay(account.id, '1001'))).status).toBe(201);
  // Drop the test logins that did nothing, so only demo logins and the real Admin are left.
  await prisma.user.deleteMany({ where: { email: { in: ['cashier@test.local', 'staff@test.local', 'board@test.local'] } } });
  return account;
}

describe('go-live cleanup', () => {
  it('covers every table in the database, so a new table cannot be forgotten', async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const listed = new Set<string>([...CLEARED_TABLES, ...KEPT_TABLES]);
    expect(tables.map((t) => t.table_name).filter((t) => !listed.has(t))).toEqual([]);
  });

  it('removes the demo data, keeps the setup and the real Admin, and starts the Audit Log fresh', async () => {
    await demoData();
    const settingsBefore = await prisma.setting.findMany({ where: { key: { notIn: ['account_no_next', 'member_no_next'] } }, orderBy: { key: 'asc' } });
    const ratesBefore = await prisma.rateSchedule.count();
    const admin = await loginAs('ADMIN');
    const adminId = await userId('admin@test.local');

    const preview = await admin.get('/api/go-live');
    expect(preview.status).toBe(200);
    expect(preview.body.done).toBeNull();
    expect(preview.body.notDemo).toEqual([]);
    expect(preview.body.remove.find((r: { key: string }) => r.key === 'payments').count).toBe(1);
    expect(preview.body.users.filter((u: { demo: boolean }) => u.demo)).toHaveLength(2);

    const done = await admin.post('/api/go-live').send({ keepUserIds: [adminId], confirm: 'go live' });
    expect(done.status).toBe(200);

    for (const count of [prisma.account.count(), prisma.payment.count(), prisma.invoice.count(), prisma.waterConnection.count()]) {
      expect(await count).toBe(0);
    }
    expect((await prisma.user.findMany()).map((u) => u.email)).toEqual(['admin@test.local']);
    expect(await prisma.setting.findMany({ where: { key: { notIn: ['account_no_next', 'member_no_next'] } }, orderBy: { key: 'asc' } })).toEqual(settingsBefore);
    expect(await prisma.rateSchedule.count()).toBe(ratesBefore);
    expect(await prisma.area.count()).toBe(2);

    const log = await prisma.auditLog.findMany();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'system.go-live', userId: adminId });
    expect(log[0].after).toMatchObject({ removedLogins: ['cashier@iwmpc.test', 'admin@iwmpc.test'], keptLogins: ['admin@test.local'] });

    // Account numbers start again from the first one.
    const created = await admin.post('/api/accounts').send({ lastName: 'Santos', firstName: 'Maria', areaId: 1 });
    expect(created.status).toBe(201);
    expect(created.body.accountNumber).toMatch(/0*1$/);

    // The Audit Log page reads it in plain words.
    const page = await admin.get('/api/audit');
    expect(page.body.entries.at(-1).summary).toBe('Go-live cleanup: removed the demo data and started this Audit Log');
  });

  it('can only be done once, and then the log can never be emptied', async () => {
    await demoData();
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/go-live').send({ confirm: 'GO LIVE' })).status).toBe(200);
    const again = await admin.post('/api/go-live').send({ confirm: 'GO LIVE' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/only be done once/);
    expect((await admin.get('/api/go-live')).body.done).toMatchObject({ by: 'ADMIN' });

    // Even asking the database directly, with the go-live permission, is refused now.
    await expect(
      prisma.$transaction([
        prisma.$executeRawUnsafe("SELECT set_config('iwmpc.go_live_cleanup', 'on', true)"),
        prisma.$executeRawUnsafe('TRUNCATE audit_log'),
      ]),
    ).rejects.toThrow(/cannot be emptied/);
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
  });

  it('refuses to empty the log without the go-live permission', async () => {
    await loginAs('ADMIN');
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_log')).rejects.toThrow(/cannot be emptied/);
  });

  it('stops when records were entered by a login that is not a demo login, until the Admin confirms they were tests', async () => {
    await demoData();
    const account = await makeAccount('Maria Santos');
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/payments').send(pay(account.id, '2001'))).status).toBe(201);

    const preview = await admin.get('/api/go-live');
    expect(preview.body.notDemo).toEqual([expect.objectContaining({ user: expect.objectContaining({ email: 'admin@test.local' }), payments: 1 })]);

    const refused = await admin.post('/api/go-live').send({ confirm: 'GO LIVE' });
    expect(refused.status).toBe(409);
    expect(await prisma.payment.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'system.go-live' } })).toBe(0);

    expect((await admin.post('/api/go-live').send({ confirm: 'GO LIVE', alsoRemoveOthers: true })).status).toBe(200);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('needs the confirmation words, an active Admin to keep, and no demo logins kept', async () => {
    await demoData();
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/go-live').send({ confirm: 'yes' })).body.error).toMatch(/GO LIVE/);
    const demoId = await userId('cashier@iwmpc.test');
    expect((await admin.post('/api/go-live').send({ confirm: 'GO LIVE', keepUserIds: [demoId] })).body.error).toMatch(/Demo logins/);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('keeps the other real logins the Admin chooses', async () => {
    await demoData();
    const passwordHash = bcrypt.hashSync(PASSWORD, 4);
    const real = await prisma.user.create({ data: { name: 'Real Cashier', email: 'lorna@iwmpc.ph', role: 'CASHIER', passwordHash } });
    const dropped = await prisma.user.create({ data: { name: 'Old Tester', email: 'tester@iwmpc.ph', role: 'STAFF', passwordHash } });
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/go-live').send({ confirm: 'GO LIVE', keepUserIds: [real.id] })).status).toBe(200);
    const left = (await prisma.user.findMany({ orderBy: { id: 'asc' } })).map((u) => u.email);
    expect(left).toEqual(['admin@test.local', 'lorna@iwmpc.ph']);
    expect(left).not.toContain(dropped.email);
  });

  it('is for Admins only', async () => {
    await demoData();
    const cashier = await loginEmail('cashier@iwmpc.test');
    expect((await cashier.get('/api/go-live')).status).toBe(403);
    expect((await cashier.post('/api/go-live').send({ confirm: 'GO LIVE' })).status).toBe(403);
    expect(await prisma.payment.count()).toBe(1);
  });
});
