import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { loginAs, makeAccount, resetDb } from './helpers';

beforeEach(resetDb);

const other = (accountId: number, orNumber: string) => ({ accountId, type: 'OTHER', amount: '150.00', orNumber, description: 'Certification fee' });

describe('the audit log cannot be changed', () => {
  it('refuses to edit or delete an entry, even straight in the database', async () => {
    await loginAs('ADMIN');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'login' } });
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'nothing' } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM audit_log')).rejects.toThrow(/cannot be changed/);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe('login');
  });
});

describe('logins and blocked attempts are recorded', () => {
  it('records a wrong password and an unknown email, never the password typed', async () => {
    await request(app).post('/api/auth/login').send({ email: 'cashier@test.local', password: 'guess-1234' });
    await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'guess-5678' });
    const failed = await prisma.auditLog.findMany({ where: { action: 'login.failed' }, orderBy: { id: 'asc' } });
    expect(failed).toHaveLength(2);
    const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@test.local' } });
    expect(failed[0]).toMatchObject({ userId: cashier.id, after: { email: 'cashier@test.local', reason: 'wrong password' } });
    expect(failed[1]).toMatchObject({ userId: null, after: { email: 'nobody@test.local', reason: 'unknown email' } });
    expect(JSON.stringify(failed)).not.toMatch(/guess/);
  });

  it('records logging out', async () => {
    const staff = await loginAs('STAFF');
    await staff.post('/api/auth/logout');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'staff@test.local' } });
    expect(await prisma.auditLog.count({ where: { action: 'logout', userId: user.id } })).toBe(1);
  });

  it('records an action the role does not allow, and still refuses it', async () => {
    const account = await makeAccount('Juan Dela Cruz');
    const staff = await loginAs('STAFF');
    const res = await staff.post('/api/payments').send(other(account.id, '7001'));
    expect(res.status).toBe(403);
    expect(await prisma.payment.count()).toBe(0);
    const denied = await prisma.auditLog.findFirstOrThrow({ where: { action: 'access.denied' } });
    expect(denied.after).toMatchObject({ method: 'POST', path: '/api/payments', role: 'STAFF' });
  });

  it('records a page the screen refused to open', async () => {
    const cashier = await loginAs('CASHIER');
    expect((await cashier.post('/api/audit/page-blocked').send({ path: '/settings/users?x=1' })).status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'page.blocked' } });
    expect(entry.after).toMatchObject({ path: '/settings/users', role: 'CASHIER' });
  });
});

describe('the Audit Log page', () => {
  it('is for Admins only', async () => {
    for (const role of ['CASHIER', 'STAFF', 'BOARD'] as const) {
      expect((await (await loginAs(role)).get('/api/audit')).status).toBe(403);
    }
    expect((await (await loginAs('ADMIN')).get('/api/audit')).status).toBe(200);
  });

  it('describes a payment and its void in plain words, with the reason and the account', async () => {
    const account = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    const paid = await cashier.post('/api/payments').send(other(account.id, '8001'));
    expect(paid.status).toBe(201);
    const admin = await loginAs('ADMIN');
    await admin.post(`/api/payments/${paid.body.id}/void`).send({ reason: 'Wrong account' });

    const res = await admin.get('/api/audit?category=money');
    expect(res.status).toBe(200);
    type Entry = { action: string };
    const voided = res.body.entries.find((e: Entry) => e.action === 'payment.void');
    const created = res.body.entries.find((e: Entry) => e.action === 'payment.create');
    expect(voided).toMatchObject({
      category: 'money',
      reason: 'Wrong account',
      user: { name: 'ADMIN' },
      account: { id: account.id },
    });
    expect(voided.summary).toMatch(/^Voided payment OR 8001 \(₱150\.00\) · Juan Dela Cruz/);
    expect(voided.changes).toContainEqual(expect.objectContaining({ label: 'Status', before: 'Active', after: 'Voided' }));
    expect(created.summary).toMatch(/^Received ₱150\.00 for Certification fee · OR 8001/);
    expect(created.user.name).toBe('CASHIER');
  });

  it('filters by person, by account, and pages through older entries', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const maria = await makeAccount('Maria Santos');
    const cashier = await loginAs('CASHIER');
    await cashier.post('/api/payments').send(other(juan.id, '9001'));
    await cashier.post('/api/payments').send(other(maria.id, '9002'));
    await cashier.post('/api/payments').send(other(juan.id, '9003'));
    const admin = await loginAs('ADMIN');
    const cashierUser = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@test.local' } });

    const juanOnly = await admin.get(`/api/audit?accountId=${juan.id}`);
    type Entry = { action: string; summary: string; account: { id: number } | null };
    const juanEntries: Entry[] = juanOnly.body.entries;
    expect(juanEntries.every((e) => e.account?.id === juan.id)).toBe(true);
    expect(juanEntries.filter((e) => e.action === 'payment.create').map((e) => e.summary.match(/OR (\d+)/)?.[1])).toEqual(['9003', '9001']);

    const byCashier = await admin.get(`/api/audit?userId=${cashierUser.id}`);
    expect(byCashier.body.entries.every((e: { user: { id: number } }) => e.user.id === cashierUser.id)).toBe(true);
    const all: Entry[] = byCashier.body.entries;
    expect(all.filter((e) => e.action === 'payment.create')).toHaveLength(3);
    expect(all.at(-1)?.action).toBe('login');

    // Page through 2 at a time: same entries, same order, nothing missed or repeated.
    const seen: string[] = [];
    let before: number | null = null;
    do {
      const page = await admin.get(`/api/audit?userId=${cashierUser.id}&limit=2${before ? `&before=${before}` : ''}`);
      expect(page.body.entries.length).toBeLessThanOrEqual(2);
      seen.push(...page.body.entries.map((e: { id: number }) => String(e.id)));
      before = page.body.nextBefore;
    } while (before);
    expect(seen).toEqual(all.map((e) => String((e as unknown as { id: number }).id)));
  });

  it('filters by Philippine calendar day', async () => {
    const admin = await loginAs('ADMIN');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    expect((await admin.get(`/api/audit?from=${today}&to=${today}`)).body.entries.length).toBeGreaterThan(0);
    expect((await admin.get('/api/audit?to=2020-01-01')).body.entries).toHaveLength(0);
    expect((await admin.get('/api/audit?from=not-a-date')).status).toBe(400);
  });
});
