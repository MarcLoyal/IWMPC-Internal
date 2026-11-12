import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { loginAs, makeAccount, membershipForm, resetDb } from './helpers';

beforeEach(resetDb);

async function member(name: string, areaId = 1) {
  const account = await makeAccount(name, 'ACTIVE');
  const n = await prisma.account.count({ where: { isMember: true } });
  return prisma.account.update({
    where: { id: account.id },
    data: { areaId, isMember: true, membershipStatus: 'MEMBER', memberNumber: String(101 + n).padStart(4, '0') },
  });
}

describe('accounts list', () => {
  it('searches by partial name, any letter case, any word order', async () => {
    await makeAccount('Juan Dela Cruz');
    await makeAccount('Maria Santos');
    const board = await loginAs('BOARD');
    for (const search of ['dela cruz', 'DELA', 'cruz juan', 'jua']) {
      const res = await board.get('/api/accounts').query({ search });
      expect(res.body.rows.map((r: { fullName: string }) => r.fullName)).toEqual(['Juan Dela Cruz']);
    }
    expect((await board.get('/api/accounts').query({ search: 'zzz' })).body.rows).toEqual([]);
  });

  it('searches by account number and member number', async () => {
    const juan = await member('Juan Dela Cruz');
    await makeAccount('Maria Santos');
    const board = await loginAs('BOARD');
    const byAccount = await board.get('/api/accounts').query({ search: juan.accountNumber });
    expect(byAccount.body.rows).toHaveLength(1);
    const byMember = await board.get('/api/accounts').query({ search: '0101' });
    expect(byMember.body.rows).toMatchObject([{ fullName: 'Juan Dela Cruz', memberNumber: '0101' }]);
  });

  it('filters by Member / Non-member and Area together, with correct counts', async () => {
    await member('Member Narra One', 1);
    await member('Member Narra Two', 1);
    await member('Member Ipil', 2);
    await makeAccount('Non Member Narra');
    const ipil = await makeAccount('Non Member Ipil');
    await prisma.account.update({ where: { id: ipil.id }, data: { areaId: 2 } });
    const board = await loginAs('BOARD');

    const all = await board.get('/api/accounts');
    expect(all.body.total).toBe(5);
    expect(all.body.counts.type).toEqual({ all: 5, members: 3, nonMembers: 2 });
    expect(all.body.counts.areas).toEqual([
      { id: 1, name: 'Narra', count: 3 },
      { id: 2, name: 'Ipil', count: 2 },
    ]);

    const membersInNarra = await board.get('/api/accounts').query({ type: 'members', areaId: 1 });
    expect(membersInNarra.body.rows.map((r: { fullName: string }) => r.fullName)).toEqual([
      'Member Narra One',
      'Member Narra Two',
    ]);
    // Each dropdown's counts respect the other dropdown.
    expect(membersInNarra.body.counts.type).toEqual({ all: 3, members: 2, nonMembers: 1 });
    expect(membersInNarra.body.counts.areas.map((a: { count: number }) => a.count)).toEqual([2, 1]);

    const nonMembers = await board.get('/api/accounts').query({ type: 'non-members' });
    expect(nonMembers.body.total).toBe(2);
    expect(nonMembers.body.rows.every((r: { memberNumber: string | null }) => r.memberNumber === null)).toBe(true);
  });
});

describe('creating and editing accounts', () => {
  it('gives each new account the next account number', async () => {
    const staff = await loginAs('STAFF');
    const a = await staff.post('/api/accounts').send({ firstName: 'Juan', lastName: 'Dela Cruz', areaId: 1 });
    const b = await staff.post('/api/accounts').send({ firstName: 'Maria', middleName: 'Clara', lastName: 'Santos', purok: 'Purok 2', barangay: 'Inicbulan', areaId: 2, civilStatus: 'WIDOWED', birthDate: '1965-07-02' });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.accountNumber, b.body.accountNumber]).toEqual(['A-0001', 'A-0002']);

    const profile = await staff.get(`/api/accounts/${b.body.id}`);
    expect(profile.body.account).toMatchObject({ fullName: 'Maria Clara Santos', address: 'Purok 2, Inicbulan', civilStatus: 'WIDOWED', birthDate: '1965-07-02', area: 'Ipil', isMember: false });
  });

  it('gives plain messages for missing details', async () => {
    const staff = await loginAs('STAFF');
    expect((await staff.post('/api/accounts').send({ firstName: 'Juan', lastName: ' ', areaId: 1 })).body.error).toBe('Please type the family name.');
    expect((await staff.post('/api/accounts').send({ lastName: 'Cruz', areaId: 1 })).body.error).toBe('Please type the given name.');
    expect((await staff.post('/api/accounts').send({ firstName: 'Juan', lastName: 'Cruz', areaId: 99 })).body.error).toBe('Please choose an area.');
    expect((await staff.post('/api/accounts').send({ firstName: 'Juan', lastName: 'Cruz', areaId: 1, birthDate: '2026-02-30' })).body.error).toBe(
      'Please enter a valid date.',
    );
  });

  it('records edits in the audit trail with before and after', async () => {
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Dela Cruz');
    await staff.put(`/api/accounts/${juan.id}`).send({ firstName: 'Juan', middleName: 'D.', lastName: 'Cruz', areaId: 2, phone: '0917 555 0101' });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'account.update' } });
    expect((log.before as { fullName: string }).fullName).toBe('Juan Dela Cruz');
    expect((log.after as { fullName: string }).fullName).toBe('Juan D. Cruz');
    expect(log.userId).toBeTruthy();
  });

  it('blocks a connection number that is already used', async () => {
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Dela Cruz');
    const maria = await makeAccount('Maria Santos');
    const first = await staff
      .post(`/api/accounts/${juan.id}/connections`)
      .send({ connectionNumber: 'WM-1', applicationDate: '2026-11-01', meterSerial: 'SN-778812', remarks: 'Near the gate' });
    expect(first.status).toBe(201);
    // From the water application form. The name on the meter defaults to the applicant.
    expect(first.body).toMatchObject({
      applicationDate: '2026-11-01',
      meterSerial: 'SN-778812',
      meterName: 'Juan Dela Cruz',
      remarks: 'Near the gate',
    });
    const dup = await staff.post(`/api/accounts/${maria.id}/connections`).send({ connectionNumber: 'WM-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain('Juan Dela Cruz');
  });

  it('moves a connection Pending -> Active -> Disconnected, and not straight to Disconnected', async () => {
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Dela Cruz');
    const created = await staff.post(`/api/accounts/${juan.id}/connections`).send({ connectionNumber: 'WM-1' });
    expect(created.body.status).toBe('PENDING_INSTALLATION');
    const id = created.body.id;

    expect((await staff.patch(`/api/connections/${id}`).send({ status: 'DISCONNECTED' })).status).toBe(400);
    const active = await staff.patch(`/api/connections/${id}`).send({ status: 'ACTIVE', installationDate: '2026-11-01' });
    expect(active.body).toMatchObject({ status: 'ACTIVE', installationDate: '2026-11-01' });
    expect((await staff.patch(`/api/connections/${id}`).send({ status: 'DISCONNECTED' })).body.status).toBe('DISCONNECTED');
  });
});

describe('roles', () => {
  it('needs a login for everything', async () => {
    for (const path of ['/api/accounts', '/api/reports/home', '/api/settings', '/api/users', '/api/payments?or=1']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('rejects a wrong password and a deactivated user', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'nope' });
    expect(wrong.status).toBe(401);

    const cashier = await loginAs('CASHIER');
    await prisma.user.update({ where: { email: 'cashier@test.local' }, data: { status: 'INACTIVE' } });
    expect((await cashier.get('/api/accounts')).status).toBe(401);
  });

  it('Board can view but not change anything', async () => {
    const board = await loginAs('BOARD');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    expect((await board.get('/api/accounts')).status).toBe(200);
    expect((await board.get(`/api/accounts/${juan.id}`)).status).toBe(200);
    expect((await board.get('/api/reports/daily')).status).toBe(200);

    const attempts = [
      board.post('/api/accounts').send({ firstName: 'X', lastName: 'Y', areaId: 1 }),
      board.put(`/api/accounts/${juan.id}`).send({ firstName: 'X', lastName: 'Y', areaId: 1 }),
      board.post(`/api/accounts/${juan.id}/make-member`).send(membershipForm('Juan Dela Cruz')),
      board.post(`/api/accounts/${juan.id}/connections`).send({ connectionNumber: 'Z' }),
      board.post('/api/payments').send({ accountId: juan.id, type: 'OTHER', amount: '1', orNumber: '1', description: 'x' }),
      board.put('/api/settings').send({ membership_fee: '1' }),
      board.get('/api/users'),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
  });

  it('Cashier records payments but cannot edit accounts; Staff edit accounts but cannot record payments', async () => {
    const cashier = await loginAs('CASHIER');
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Dela Cruz');
    const payment = { accountId: juan.id, type: 'OTHER', amount: '1', orNumber: '1', description: 'x' };

    expect((await cashier.post('/api/accounts').send({ firstName: 'X', lastName: 'Y', areaId: 1 })).status).toBe(403);
    expect((await cashier.put('/api/settings').send({ membership_fee: '1' })).status).toBe(403);
    expect((await staff.post('/api/payments').send(payment)).status).toBe(403);
    expect((await staff.post('/api/users').send({})).status).toBe(403);
    expect((await cashier.post('/api/payments').send(payment)).status).toBe(201);
  });

  it('Admin manages users, and the last active Admin cannot be removed', async () => {
    const admin = await loginAs('ADMIN');
    const created = await admin
      .post('/api/users')
      .send({ name: 'New Cashier', email: 'New@Test.local', password: 'longenough', role: 'CASHIER' });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('new@test.local');
    expect(JSON.stringify(created.body)).not.toMatch(/password/i);

    const login = await request(app).post('/api/auth/login').send({ email: 'new@test.local', password: 'longenough' });
    expect(login.status).toBe(200);

    expect((await admin.post('/api/users').send({ name: 'A', email: 'new@test.local', password: 'longenough', role: 'STAFF' })).status).toBe(409);
    expect((await admin.post('/api/users').send({ name: 'A', email: 'a@test.local', password: 'short', role: 'STAFF' })).status).toBe(400);

    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } });
    const demote = await admin.put(`/api/users/${me.id}`).send({ name: 'ADMIN', role: 'STAFF', status: 'ACTIVE' });
    expect(demote.status).toBe(400);
    expect(demote.body.error).toMatch(/at least one active Admin/);
  });

  it('Admin changes fees and areas; bad amounts are refused', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.put('/api/settings').send({ membership_fee: '1,000', installation_fee: '3500.5' })).status).toBe(200);
    const settings = await admin.get('/api/settings');
    expect(settings.body).toMatchObject({ membership_fee: '1000.00', installation_fee: '3500.50', nextAccountNumber: 'A-0001' });
    expect((await admin.put('/api/settings').send({ membership_fee: 'abc' })).status).toBe(400);

    expect((await admin.post('/api/areas').send({ name: 'Molave' })).status).toBe(201);
    expect((await admin.post('/api/areas').send({ name: 'narra' })).status).toBe(409);
    expect((await admin.put('/api/areas/1').send({ name: 'Narra 1' })).body.name).toBe('Narra 1');
  });
});
