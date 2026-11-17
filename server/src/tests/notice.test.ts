import { PNG } from 'pngjs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { todayManila } from '../lib/dates';
import { addDays, addMonths, periodOf } from '../lib/periods';
import { cleanSignature } from '../services/signatures';
import { loginAs, makeAccount, resetDb } from './helpers';

const today = todayManila();
const THIS = periodOf(today);
const month = (n: number) => addMonths(THIS, n);
type Agent = Awaited<ReturnType<typeof loginAs>>;

beforeEach(resetDb);

async function customer(name: string, areaId = 1, start = 1000) {
  const account = await makeAccount(name, 'ACTIVE');
  await prisma.account.update({ where: { id: account.id }, data: { areaId } });
  const c = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: account.id } });
  await prisma.waterConnection.update({ where: { id: c.id }, data: { initialReading: start, meterName: 'Meco', meterSerial: `19-${c.id}` } });
  return { accountId: account.id, connectionId: c.id };
}

async function read(staff: Agent, connectionId: number, current: number, period = THIS, readDate = today) {
  const res = await staff.post('/api/water/readings').send({ period, readDate, readings: [{ connectionId, currentReading: current }] });
  expect(res.body.saved).toBe(1);
}

const printed = async (user: Agent, query: Record<string, string> = {}) => (await user.get('/api/water/print/bills').query({ period: THIS, ...query })).body;

/** A PNG of dark "ink" on a white background, like a scanned signature. */
function signaturePng(withWhite = true): Buffer {
  const png = new PNG({ width: 120, height: 50 });
  for (let y = 0; y < 50; y++)
    for (let x = 0; x < 120; x++) {
      const i = (y * 120 + x) * 4;
      const ink = y > 20 && y < 30 && x > 10 && x < 110;
      const v = ink ? 20 : 255;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = ink ? 90 : 255;
      png.data[i + 3] = ink || withWhite ? 255 : 0;
    }
  return PNG.sync.write(png);
}

describe('which form each account gets', () => {
  async function setup() {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    // Juan: last month and this month unpaid -> notice. Maria: only this month -> monthly bill.
    // Pedro: last month unpaid but this month paid -> only 1 month owed -> monthly bill.
    const juan = await customer('Juan Dela Cruz');
    const maria = await customer('Maria Santos');
    const pedro = await customer('Pedro Bautista');
    for (const c of [juan, maria, pedro]) {
      if (c !== maria) await read(staff, c.connectionId, 1022, month(-1), addDays(today, -40));
      await read(staff, c.connectionId, c === maria ? 1023 : 1045);
    }
    const pedroNow = await prisma.waterBill.findFirstOrThrow({ where: { connectionId: pedro.connectionId, period: THIS } });
    await cashier.post('/api/payments').send({ accountId: pedro.accountId, type: 'WATER_BILL', amount: '535.40', orNumber: '7001', waterBillId: pedroNow.id });
    return { staff, cashier, juan, maria, pedro };
  }

  it('gives accounts with 2 or more unpaid months the notice, and the others the monthly bill', async () => {
    const { staff } = await setup();
    const all = (await printed(staff)).bills;
    expect(all.map((b: { accountName: string; form: string; unpaidMonths: number }) => [b.accountName, b.form, b.unpaidMonths])).toEqual([
      ['Juan Dela Cruz', 'NOTICE', 2],
      ['Maria Santos', 'BILL', 1],
      ['Pedro Bautista', 'BILL', 1],
    ]);
    const names = async (form: string) => (await printed(staff, { form })).bills.map((b: { accountName: string }) => b.accountName);
    expect(await names('notice')).toEqual(['Juan Dela Cruz']);
    expect(await names('bill')).toEqual(['Maria Santos', 'Pedro Bautista']);

    const s = (await staff.get('/api/water/print/summary')).body;
    expect(s).toMatchObject({ bills: 3, monthlyBills: 2, notices: 1, pages: 2 });
    expect((await staff.get('/api/water/print/summary').query({ form: 'notice' })).body).toMatchObject({ bills: 1, monthlyBills: 0, notices: 1, pages: 1 });

    // Raising the trigger to 3 months turns Juan's notice back into a monthly bill.
    const admin = await loginAs('ADMIN');
    await admin.put('/api/settings').send({ notice_threshold_months: '3' });
    expect((await printed(staff, { form: 'notice' })).bills).toEqual([]);
  });

  it('works out the amount, penalty and total of each unpaid month and in total', async () => {
    const { staff, cashier, juan } = await setup();
    let notice = (await printed(staff, { form: 'notice' })).bills[0].notice;
    // Last month: 22 cu.m = 510.60, overdue so 10% penalty 51.06. This month: 23 cu.m = 535.40, not yet due.
    expect(notice.rows).toEqual([
      { month: expect.stringMatching(/^\w{3} \d{4}$/), cubicMeters: 22, amount: '510.60', penalty: '51.06', total: '561.66' },
      { month: expect.stringMatching(/^\w{3} \d{4}$/), cubicMeters: 23, amount: '535.40', penalty: '0.00', total: '535.40' },
    ]);
    expect(notice.totals).toEqual({ amount: '1046.00', penalty: '51.06', total: '1097.06' });
    // Exactly what the account owes.
    expect((await staff.get(`/api/accounts/${juan.accountId}`)).body.water.totalDue).toBe('1097.06');

    // A part payment counts against the amount first, then the penalty.
    const last = await prisma.waterBill.findFirstOrThrow({ where: { connectionId: juan.connectionId, period: month(-1) } });
    await cashier.post('/api/payments').send({ accountId: juan.accountId, type: 'WATER_BILL', amount: '520.60', orNumber: '7002', waterBillId: last.id });
    notice = (await printed(staff, { form: 'notice' })).bills[0].notice;
    expect(notice.rows[0]).toMatchObject({ amount: '0.00', penalty: '41.06', total: '41.06' });
    expect(notice.totals).toEqual({ amount: '535.40', penalty: '41.06', total: '576.46' });
  });

  it('sets the disconnection date from the rule, or from the batch', async () => {
    const { staff } = await setup();
    const n = (await printed(staff, { form: 'notice' })).bills[0].notice;
    const due = (await prisma.waterBill.findFirstOrThrow({ where: { period: THIS, connection: { account: { fullName: 'Juan Dela Cruz' } } } })).dueDate.toISOString().slice(0, 10);
    expect(n.dueDate).toBe(due);
    expect(n.disconnectionDate).toBe(addDays(due, 5));

    const admin = await loginAs('ADMIN');
    await admin.put('/api/settings').send({ disconnect_days_after_due: '10' });
    expect((await printed(staff, { form: 'notice' })).bills[0].notice.disconnectionDate).toBe(addDays(due, 10));
    expect((await printed(staff, { form: 'notice', disconnectDate: '2027-01-20' })).bills[0].notice.disconnectionDate).toBe('2027-01-20');
    expect((await staff.get('/api/water/print/bills').query({ disconnectDate: '2027-02-30' })).status).toBe(400);
  });

  it('combines the oldest months when there are more than fit, keeping the totals exact', async () => {
    const staff = await loginAs('STAFF');
    const c = await customer('Corazon Mercado');
    for (let i = 14; i >= 1; i--) await read(staff, c.connectionId, 1000 + (15 - i) * 10, month(-i), addDays(today, -i * 31 - 5));
    await read(staff, c.connectionId, 1150);
    const n = (await printed(staff, { form: 'notice' })).bills[0].notice;
    expect(n.rows).toHaveLength(12);
    expect(n.rows[0].month).toMatch(/-/);
    const sum = n.rows.reduce((s: number, r: { total: string }) => s + Number(r.total), 0);
    expect(sum.toFixed(2)).toBe(n.totals.total);
    expect(n.totals.total).toBe((14 * 205.15 + 186.5).toFixed(2));
  });

  it('prints the notice header from Settings', async () => {
    const admin = await loginAs('ADMIN');
    let h = (await admin.get('/api/water/print/bills')).body.noticeHeader;
    expect(h).toMatchObject({
      phoneLine: 'Tel. No. 043 740-0767   Mobile No. +63910 491 8512',
      penaltyLabel: 'PENALTY (10%)',
      reconnectionFee: '1000.00',
      thresholdMonths: 2,
      perPage: 1,
      signatories: [
        { label: 'Prepared by:', name: 'Maria B. Ilagan', title: 'Billing Officer' },
        { name: 'Emard B. Ramos', title: 'Cashier/Collector' },
        { name: 'Marino R. Abanador', title: 'General Manager' },
      ],
    });
    await admin.put('/api/settings').send({ reconnection_fee: '1500', reason: 'Board resolution 12', notice_per_page: '2', notice_preparer_name: 'Ana Reyes' });
    h = (await admin.get('/api/water/print/bills')).body.noticeHeader;
    expect(h).toMatchObject({ reconnectionFee: '1500.00', perPage: 2 });
    expect(h.signatories[0].name).toBe('Ana Reyes');
  });
});

describe('money settings need a reason and keep a history', () => {
  it('refuses a penalty or reconnection fee change without a reason, and records every change', async () => {
    const admin = await loginAs('ADMIN');
    const refused = await admin.put('/api/settings').send({ water_penalty_value: '12' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/reason/);
    expect((await admin.put('/api/settings').send({ reconnection_fee: '1200' })).status).toBe(400);
    // Saving the same value again needs no reason and records nothing.
    expect((await admin.put('/api/settings').send({ water_penalty_value: '10' })).status).toBe(200);

    await admin.put('/api/settings').send({ water_penalty_value: '12', reason: 'Approved by the board' });
    const history = (await admin.get('/api/settings/history').query({ keys: 'water_penalty_value,reconnection_fee' })).body.history;
    expect(history).toMatchObject([{ key: 'water_penalty_value', oldValue: '10', newValue: '12.00', reason: 'Approved by the board', changedBy: 'ADMIN' }]);
    expect((await admin.get('/api/water/print/bills')).body.noticeHeader.penaltyLabel).toBe('PENALTY (12%)');
    for (const role of ['STAFF', 'CASHIER', 'BOARD'] as const) {
      expect((await (await loginAs(role)).get('/api/settings/history')).status).toBe(403);
    }
  });
});

describe('signatures', () => {
  it('turns a white background transparent and trims the edges', () => {
    const { png, width, height } = cleanSignature(signaturePng(true));
    const img = PNG.sync.read(png);
    expect([width, height]).toEqual([img.width, img.height]);
    expect(width).toBeLessThan(120);
    expect(height).toBeLessThan(20);
    // A corner (was white) is now see-through; the middle (ink) is solid.
    expect(img.data[3]).toBe(0);
    const mid = ((Math.floor(height / 2) * width + Math.floor(width / 2)) * 4) + 3;
    expect(img.data[mid]).toBe(255);
    expect(() => cleanSignature(Buffer.from('not a png'))).toThrow(/PNG/);
    const blank = new PNG({ width: 50, height: 20 });
    blank.data.fill(255);
    expect(() => cleanSignature(PNG.sync.write(blank))).toThrow(/No signature/);
  });

  it('only an Admin can upload, see, replace, remove or switch signatures, and every change is logged', async () => {
    const admin = await loginAs('ADMIN');
    const up = await admin.put('/api/signatures/bill_preparer').set('Content-Type', 'image/png').send(signaturePng());
    expect(up.status).toBe(200);
    const preview = await admin.get('/api/signatures/bill_preparer/preview');
    expect(preview.headers['content-type']).toBe('image/png');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect((await admin.get('/api/signatures')).body.signatures[0]).toMatchObject({ slot: 'bill_preparer', print: true, hasImage: true, updatedBy: 'ADMIN' });

    for (const role of ['STAFF', 'CASHIER', 'BOARD'] as const) {
      const user = await loginAs(role);
      expect((await user.get('/api/signatures')).status).toBe(403);
      expect((await user.get('/api/signatures/bill_preparer/preview')).status).toBe(403);
      expect((await user.put('/api/signatures/bill_preparer').set('Content-Type', 'image/png').send(signaturePng())).status).toBe(403);
      expect((await user.delete('/api/signatures/bill_preparer')).status).toBe(403);
      expect((await user.put('/api/signatures/bill_preparer/print').send({ print: false })).status).toBe(403);
    }
    expect((await request(app).get('/api/signatures/bill_preparer/preview')).status).toBe(401);
    expect((await admin.put('/api/signatures/nobody').set('Content-Type', 'image/png').send(signaturePng())).status).toBe(404);

    await admin.put('/api/signatures/bill_preparer').set('Content-Type', 'image/png').send(signaturePng());
    await admin.put('/api/signatures/bill_preparer/print').send({ print: false });
    await admin.delete('/api/signatures/bill_preparer');
    const actions = (await prisma.auditLog.findMany({ where: { entity: 'signature' }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['signature.upload', 'signature.replace', 'signature.print-off', 'signature.remove']);
    expect((await admin.get('/api/signatures/bill_preparer/preview')).status).toBe(404);
  });

  it('goes into the print data only when switched on; otherwise the bill gets a blank line', async () => {
    const admin = await loginAs('ADMIN');
    const staff = await loginAs('STAFF');
    const c = await customer('Juan Dela Cruz');
    await read(staff, c.connectionId, 1010);
    await admin.put('/api/signatures/bill_preparer').set('Content-Type', 'image/png').send(signaturePng());
    await admin.put('/api/signatures/notice_manager').set('Content-Type', 'image/png').send(signaturePng());

    let data = await printed(staff);
    expect(Object.keys(data.signatures.bill)).toEqual(['preparer']);
    expect(Object.keys(data.signatures.notice)).toEqual(['manager']);
    const sent = Buffer.from(data.signatures.bill.preparer, 'base64');
    expect(PNG.sync.read(sent).data[3]).toBe(0);
    // Later pages of a big batch do not repeat them.
    expect((await printed(staff, { offset: '500' })).signatures).toBeNull();

    await admin.put('/api/signatures/bill_preparer/print').send({ print: false });
    data = await printed(staff);
    expect(data.signatures.bill).toEqual({});

    // Board can no longer print, so never receives signatures.
    const board = await loginAs('BOARD');
    expect((await board.get('/api/water/print/bills')).status).toBe(403);
    expect((await board.get('/api/water/print/summary')).status).toBe(403);
    expect((await board.post('/api/water/print/record').send({ billIds: [1] })).status).toBe(403);
  });
});
