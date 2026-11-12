import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila } from '../lib/dates';
import { loginAs, makeAccount, resetDb } from './helpers';

beforeEach(resetDb);

const other = (accountId: number, orNumber: string, amount = '100.00') => ({
  accountId,
  type: 'OTHER',
  amount,
  orNumber,
  description: 'Certification fee',
});

describe('recording payments', () => {
  it('saves a payment with its OR number, and it shows on the account and the daily report', async () => {
    const account = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');

    const res = await cashier.post('/api/payments').send(other(account.id, '1045', '1,250.50'));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ orNumber: '1045', amount: '1250.50', status: 'ACTIVE', createdBy: 'CASHIER' });

    const profile = await cashier.get(`/api/accounts/${account.id}`);
    expect(profile.body.payments.map((p: { orNumber: string }) => p.orNumber)).toEqual(['1045']);

    const report = await cashier.get('/api/reports/daily');
    expect(report.body.date).toBe(todayManila());
    expect(report.body.payments).toHaveLength(1);
    expect(report.body.grandTotal).toBe('1250.50');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'payment.create' } });
    expect(audit?.userId).toBeTruthy();
  });

  it('requires an OR number', async () => {
    const account = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    for (const orNumber of ['', '   ', undefined]) {
      const res = await cashier.post('/api/payments').send({ ...other(account.id, ''), orNumber });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/OR number/);
    }
    expect(await prisma.payment.count()).toBe(0);
  });

  it('rejects bad amounts and a missing description for Other', async () => {
    const account = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    for (const amount of ['0', '-5', 'abc', '10.999']) {
      expect((await cashier.post('/api/payments').send(other(account.id, '1', amount))).status).toBe(400);
    }
    const noDescription = await cashier.post('/api/payments').send({ ...other(account.id, '2'), description: ' ' });
    expect(noDescription.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe('duplicate OR numbers', () => {
  it('blocks a reused OR number and says who and when it was used for', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const maria = await makeAccount('Maria Santos');
    const cashier = await loginAs('CASHIER');

    expect((await cashier.post('/api/payments').send(other(juan.id, '1045'))).status).toBe(201);
    const dup = await cashier.post('/api/payments').send(other(maria.id, '1045'));

    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain('1045');
    expect(dup.body.error).toContain('Juan Dela Cruz');
    expect(dup.body.error).toMatch(/\d{4}/); // the date
    expect(await prisma.payment.count()).toBe(1);
  });

  it('treats spaces and letter case as the same OR number', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    expect((await cashier.post('/api/payments').send(other(juan.id, 'a-1045'))).status).toBe(201);
    expect((await cashier.post('/api/payments').send(other(juan.id, ' A-1045 '))).status).toBe(409);
  });

  it('still blocks an OR number that belongs to a voided payment', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const admin = await loginAs('ADMIN');
    const first = await admin.post('/api/payments').send(other(juan.id, '1045'));
    await admin.post(`/api/payments/${first.body.id}/void`).send({ reason: 'Cancelled receipt' });

    const again = await admin.post('/api/payments').send(other(juan.id, '1045'));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/voided/);
  });

  it('lets only one of two simultaneous saves with the same OR number through', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    const results = await Promise.all([
      cashier.post('/api/payments').send(other(juan.id, '2000')),
      cashier.post('/api/payments').send(other(juan.id, '2000')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('finds a payment by OR number', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    await cashier.post('/api/payments').send(other(juan.id, '1045'));
    const found = await cashier.get('/api/payments').query({ or: ' 1045 ' });
    expect(found.body.payment).toMatchObject({ orNumber: '1045', accountName: 'Juan Dela Cruz' });
    const missing = await cashier.get('/api/payments').query({ or: '9999' });
    expect(missing.body.payment).toBeNull();
  });
});

describe('voiding', () => {
  it('is admin only', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const cashier = await loginAs('CASHIER');
    const payment = await cashier.post('/api/payments').send(other(juan.id, '1045'));
    for (const role of ['CASHIER', 'STAFF', 'BOARD'] as const) {
      const res = await (await loginAs(role)).post(`/api/payments/${payment.body.id}/void`).send({ reason: 'x' });
      expect(res.status).toBe(403);
    }
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('ACTIVE');
  });

  it('requires a reason', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const admin = await loginAs('ADMIN');
    const payment = await admin.post('/api/payments').send(other(juan.id, '1045'));
    const res = await admin.post(`/api/payments/${payment.body.id}/void`).send({ reason: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });

  it('keeps the voided payment visible with its OR number, but out of the totals', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const admin = await loginAs('ADMIN');
    await admin.post('/api/payments').send(other(juan.id, '1045', '100'));
    const wrong = await admin.post('/api/payments').send(other(juan.id, '1046', '999'));

    const voided = await admin.post(`/api/payments/${wrong.body.id}/void`).send({ reason: 'Wrong amount' });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: 'VOID', orNumber: '1046', voidReason: 'Wrong amount', voidedBy: 'ADMIN' });

    const report = await admin.get('/api/reports/daily');
    expect(report.body.payments.map((p: { orNumber: string }) => p.orNumber)).toEqual(['1045', '1046']);
    expect(report.body.grandTotal).toBe('100.00');
    expect(report.body.count).toBe(1);
    expect(report.body.voidedCount).toBe(1);
    expect(report.body.totals).toEqual([{ type: 'OTHER', count: 1, total: '100.00' }]);

    const home = await admin.get('/api/reports/home');
    expect(home.body.collections).toEqual({ total: '100.00', count: 1 });

    const profile = await admin.get(`/api/accounts/${juan.id}`);
    expect(profile.body.payments).toHaveLength(2);
  });

  it('cannot void twice, and payments cannot be deleted or edited', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    const admin = await loginAs('ADMIN');
    const payment = await admin.post('/api/payments').send(other(juan.id, '1045'));
    await admin.post(`/api/payments/${payment.body.id}/void`).send({ reason: 'Cancelled' });
    expect((await admin.post(`/api/payments/${payment.body.id}/void`).send({ reason: 'Again' })).status).toBe(400);
    expect((await admin.delete(`/api/payments/${payment.body.id}`)).status).toBe(404);
    expect((await admin.put(`/api/payments/${payment.body.id}`).send({ amount: '1' })).status).toBe(404);
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe('daily collection report', () => {
  it('totals per payment type and flags OR gaps', async () => {
    const juan = await makeAccount('Juan Dela Cruz', 'PENDING_INSTALLATION');
    const cashier = await loginAs('CASHIER');
    await cashier.post('/api/payments').send(other(juan.id, '1045', '100'));
    await cashier.post('/api/payments').send(other(juan.id, '1046', '50.25'));
    await cashier.post('/api/payments').send({ accountId: juan.id, type: 'INSTALLATION_FEE', amount: '3500', orNumber: '1048' });

    const report = await cashier.get('/api/reports/daily');
    expect(report.body.totals).toEqual([
      { type: 'INSTALLATION_FEE', count: 1, total: '3500.00' },
      { type: 'OTHER', count: 2, total: '150.25' },
    ]);
    expect(report.body.grandTotal).toBe('3650.25');
    expect(report.body.orGaps).toHaveLength(1);
    expect(report.body.orGaps[0].missing).toEqual(['1047']);
  });

  it('is empty for a day with no payments', async () => {
    const board = await loginAs('BOARD');
    const report = await board.get('/api/reports/daily').query({ date: '2020-01-01' });
    expect(report.body).toMatchObject({ payments: [], grandTotal: '0.00', orGaps: [] });
  });

  it('links an installation fee to the pending connection and clears it from what is owed', async () => {
    const juan = await makeAccount('Juan Dela Cruz', 'PENDING_INSTALLATION');
    const cashier = await loginAs('CASHIER');
    const before = await cashier.get(`/api/accounts/${juan.id}`);
    expect(before.body.owed).toMatchObject([{ type: 'INSTALLATION_FEE', amount: '3500.00' }]);

    await cashier.post('/api/payments').send({ accountId: juan.id, type: 'INSTALLATION_FEE', amount: '3500', orNumber: '1' });
    const after = await cashier.get(`/api/accounts/${juan.id}`);
    expect(after.body.owed).toEqual([]);
    expect((await prisma.payment.findFirstOrThrow()).connectionId).toBeTruthy();
  });
});
