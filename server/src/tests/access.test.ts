import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila, toDbDate } from '../lib/dates';
import { addDays } from '../lib/periods';
import { loginAs, makeAccount, resetDb } from './helpers';

beforeEach(resetDb);

const userId = async (role: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${role.toLowerCase()}@test.local` } })).id;
const reading = (connectionId: number) => ({ period: '2026-10', readDate: '2026-10-28', readings: [{ connectionId, currentReading: 25 }] });
const grant = (work: string, extra: Record<string, unknown> = {}) => ({ work, requestedBy: 'Manager Reyes', reason: 'Encoder on leave', ...extra });

async function connection() {
  const account = await makeAccount('Juan Dela Cruz', 'ACTIVE');
  return prisma.waterConnection.findFirstOrThrow({ where: { accountId: account.id } });
}

describe('giving extra access', () => {
  it('lets a Cashier encode meter readings once an Admin gives it, and stops when it is removed', async () => {
    const conn = await connection();
    const cashier = await loginAs('CASHIER');
    const admin = await loginAs('ADMIN');
    const cashierId = await userId('CASHIER');

    expect((await cashier.post('/api/water/readings').send(reading(conn.id))).status).toBe(403);
    expect((await cashier.get('/api/auth/me')).body.user.work.sort()).toEqual(['CASHIER', 'PRINT']);

    const given = await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS'));
    expect(given.status).toBe(201);
    expect(given.body).toMatchObject({ work: 'READINGS', requestedBy: 'Manager Reyes', reason: 'Encoder on leave', endsOn: null, grantedBy: 'ADMIN' });

    // Takes effect on the next request, without logging in again.
    expect((await cashier.get('/api/auth/me')).body.user.work).toContain('READINGS');
    const saved = await cashier.post('/api/water/readings').send(reading(conn.id));
    expect(saved.status).toBe(200);
    const entered = await prisma.auditLog.findFirstOrThrow({ where: { action: 'reading.create' } });
    expect(entered.userId).toBe(cashierId);

    const removed = await admin.post(`/api/users/${cashierId}/access/${given.body.id}/remove`).send({ reason: 'Encoder is back' });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ removedBy: 'ADMIN', removeReason: 'Encoder is back' });
    expect((await cashier.post('/api/water/readings').send(reading(conn.id))).status).toBe(403);
    expect((await admin.post(`/api/users/${cashierId}/access/${given.body.id}/remove`).send({})).status).toBe(409);
  });

  it('records who gave it, who asked, why, and who removed it, in the Audit Log', async () => {
    const admin = await loginAs('ADMIN');
    const staffId = await userId('STAFF');
    const endsOn = addDays(todayManila(), 7);
    const given = await admin.post(`/api/users/${staffId}/access`).send(grant('CASHIER', { endsOn }));
    await admin.post(`/api/users/${staffId}/access/${given.body.id}/remove`).send({ reason: 'No longer needed' });

    const log = await admin.get('/api/audit?category=users');
    const [removed, granted] = log.body.entries;
    expect(granted.action).toBe('user.access-grant');
    expect(granted.summary).toMatch(/^Gave STAFF extra access: Work the Cashier: receive payments and sell rice & LPG \(until .+\) · requested by Manager Reyes$/);
    expect(granted.reason).toBe('Encoder on leave');
    expect(granted.user.name).toBe('ADMIN');
    expect(removed).toMatchObject({ action: 'user.access-remove', reason: 'No longer needed' });
    expect(removed.summary).toBe('Removed extra access from STAFF: Work the Cashier: receive payments and sell rice & LPG');
  });

  it('needs who asked and why, and refuses what does not make sense', async () => {
    const admin = await loginAs('ADMIN');
    const cashierId = await userId('CASHIER');
    expect((await admin.post(`/api/users/${cashierId}/access`).send({ work: 'READINGS', reason: 'x' })).body.error).toMatch(/who asked/);
    expect((await admin.post(`/api/users/${cashierId}/access`).send({ work: 'READINGS', requestedBy: 'x' })).body.error).toMatch(/reason/);
    expect((await admin.post(`/api/users/${cashierId}/access`).send(grant('VOID'))).status).toBe(400);
    expect((await admin.post(`/api/users/${cashierId}/access`).send(grant('CASHIER'))).body.error).toMatch(/already part of their role/);
    expect((await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS', { endsOn: '2020-01-01' }))).body.error).toMatch(/past/);
    expect((await admin.post(`/api/users/${await userId('ADMIN')}/access`).send(grant('READINGS'))).body.error).toMatch(/everything/);
    expect((await admin.post(`/api/users/${await userId('BOARD')}/access`).send(grant('READINGS'))).body.error).toMatch(/view only/);
    expect((await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS'))).status).toBe(201);
    expect((await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS'))).status).toBe(409);
    expect(await prisma.accessGrant.count()).toBe(1);
  });

  it('only Admins can give or remove access', async () => {
    const cashierId = await userId('CASHIER');
    for (const role of ['CASHIER', 'STAFF', 'BOARD'] as const) {
      expect((await (await loginAs(role)).post(`/api/users/${cashierId}/access`).send(grant('READINGS'))).status).toBe(403);
    }
    expect(await prisma.accessGrant.count()).toBe(0);
  });

  it('never gives Admin-only work: a Cashier with extra access still cannot void', async () => {
    const account = await makeAccount('Juan Dela Cruz');
    const admin = await loginAs('ADMIN');
    const cashierId = await userId('CASHIER');
    for (const work of ['READINGS', 'ACCOUNTS']) await admin.post(`/api/users/${cashierId}/access`).send(grant(work));
    const cashier = await loginAs('CASHIER');
    const paid = await cashier.post('/api/payments').send({ accountId: account.id, type: 'OTHER', amount: '100', orNumber: '501', description: 'Fee' });
    expect(paid.status).toBe(201);
    expect((await cashier.post(`/api/payments/${paid.body.id}/void`).send({ reason: 'x' })).status).toBe(403);
    expect((await cashier.get('/api/users')).status).toBe(403);
  });
});

describe('end dates', () => {
  it('works through the end date, then ends by itself and is recorded', async () => {
    const conn = await connection();
    const admin = await loginAs('ADMIN');
    const cashierId = await userId('CASHIER');
    const today = todayManila();
    const given = await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS', { endsOn: today }));
    expect(given.status).toBe(201);
    const cashier = await loginAs('CASHIER');
    expect((await cashier.post('/api/water/readings').send(reading(conn.id))).status).toBe(200);

    // Pretend the end date was yesterday. (Only the audit log refuses edits; grants can be closed.)
    await prisma.accessGrant.update({ where: { id: given.body.id }, data: { endsOn: toDbDate(addDays(today, -1)) } });
    expect((await cashier.post('/api/water/readings').send(reading(conn.id))).status).toBe(403);

    const closed = await prisma.accessGrant.findUniqueOrThrow({ where: { id: given.body.id } });
    expect(closed).toMatchObject({ removedById: null, removeReason: 'Reached its end date' });
    expect(closed.removedAt).not.toBeNull();
    const expired = await prisma.auditLog.findMany({ where: { action: 'user.access-expire' } });
    expect(expired).toHaveLength(1);
    expect(expired[0].userId).toBeNull();

    // Seen again: not recorded twice.
    await cashier.get('/api/auth/me');
    await admin.get('/api/users');
    expect(await prisma.auditLog.count({ where: { action: 'user.access-expire' } })).toBe(1);
  });
});

describe('role changes and history', () => {
  it('ends open extra access when the user becomes an Admin or Board', async () => {
    const admin = await loginAs('ADMIN');
    const cashierId = await userId('CASHIER');
    await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS'));
    const res = await admin.put(`/api/users/${cashierId}`).send({ name: 'CASHIER', role: 'BOARD', status: 'ACTIVE' });
    expect(res.status).toBe(200);
    const g = await prisma.accessGrant.findFirstOrThrow({ where: { userId: cashierId } });
    expect(g.removeReason).toBe('Role changed to Board');
  });

  it('keeps every grant: they cannot be deleted', async () => {
    const admin = await loginAs('ADMIN');
    const given = await admin.post(`/api/users/${await userId('CASHIER')}/access`).send(grant('READINGS'));
    await expect(prisma.accessGrant.delete({ where: { id: given.body.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it('shows each user their role work and their grants on the Users list', async () => {
    const admin = await loginAs('ADMIN');
    const cashierId = await userId('CASHIER');
    await admin.post(`/api/users/${cashierId}/access`).send(grant('READINGS'));
    const res = await admin.get('/api/users');
    const cashier = res.body.users.find((u: { id: number }) => u.id === cashierId);
    expect(cashier).toMatchObject({ roleWork: ['CASHIER', 'PRINT'], canGetExtra: true });
    expect(cashier.grants).toHaveLength(1);
    expect(res.body.work.map((w: { key: string }) => w.key)).toEqual(['CASHIER', 'READINGS', 'ACCOUNTS', 'PRINT']);
  });
});
