import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila } from '../lib/dates';
import { addDays, addMonths, periodOf } from '../lib/periods';
import { amountInWords } from '../services/invoices';
import { loginAs, makeAccount, resetDb } from './helpers';

const today = todayManila();
const THIS = periodOf(today);
const month = (n: number) => addMonths(THIS, n);
type Agent = Awaited<ReturnType<typeof loginAs>>;

beforeEach(async () => {
  await resetDb();
  await prisma.product.create({
    data: { name: 'Dinorado', category: 'RICE', units: { create: [{ label: 'per sack (25 kg)', price: 1550 }] } },
  });
});

async function customer(name = 'Marcelo Gandiola', start = 248) {
  const account = await makeAccount(name, 'ACTIVE');
  await prisma.account.update({ where: { id: account.id }, data: { tin: '123-456-789', address: 'Purok 3, Inicbulan, Bauan, Batangas' } });
  const c = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: account.id } });
  await prisma.waterConnection.update({ where: { id: c.id }, data: { initialReading: start, meterName: 'Meco', meterSerial: '19-007508' } });
  return { accountId: account.id, connectionId: c.id };
}

async function read(staff: Agent, connectionId: number, current: number, period = THIS, readDate = today) {
  const res = await staff.post('/api/water/readings').send({ period, readDate, readings: [{ connectionId, currentReading: current }] });
  expect(res.body.saved).toBe(1);
  return prisma.waterBill.findFirstOrThrow({ where: { connectionId, period } });
}

const invoice = (accountId: number | null, number: string, items: unknown[], extra: Record<string, unknown> = {}) => ({ accountId, number, items, ...extra });

describe('amount in words', () => {
  it('writes amounts the way they go on the invoice', () => {
    expect(amountInWords('280.70')).toBe('Two Hundred Eighty Pesos and 70/100');
    expect(amountInWords('1')).toBe('One Peso and 00/100');
    expect(amountInWords('1405.83')).toBe('One Thousand Four Hundred Five Pesos and 83/100');
    expect(amountInWords('21')).toBe('Twenty-One Pesos and 00/100');
    expect(amountInWords('1000000')).toBe('One Million Pesos and 00/100');
    expect(amountInWords('2512345.05')).toBe('Two Million Five Hundred Twelve Thousand Three Hundred Forty-Five Pesos and 05/100');
    expect(amountInWords('0.50')).toBe('Zero Pesos and 50/100');
  });
});

describe('the invoice guide', () => {
  it('matches a water payment line by line, like the paper invoice', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const c = await customer();
    const bill = await read(staff, c.connectionId, 262); // 14 cu.m = 280.70
    const saved = await cashier.post('/api/invoices').send(invoice(c.accountId, '28101', [{ type: 'WATER_BILL', waterBillId: bill.id, amount: '280.70' }]));
    expect(saved.status).toBe(201);
    const g = saved.body.guide;
    expect(g).toMatchObject({
      number: '28101',
      date: today,
      cashSales: true,
      chargeSales: false,
      cancelled: false,
      registeredName: 'Marcelo Gandiola',
      tin: '123-456-789',
      meterNo: 'Meco # 19-007508',
      businessAddress: 'Purok 3, Inicbulan, Bauan, Batangas',
      water: { present: 262, previous: 248, cubicMeters: 14, amount: '280.70' },
      assessment: null,
      penalty: null,
      connection: null,
      store: null,
      loans: null,
      others: [],
      totalSales: '280.70',
      discount: null,
      withholdingTax: null,
      totalAmountDue: '280.70',
      amountInWords: 'Two Hundred Eighty Pesos and 70/100',
    });
    expect(g.header).toMatchObject({ tinLine: 'NON VAT Reg. TIN-272-721-784-00000', phoneLine: 'Tel. No. (043) 740-0767 / 0910-491-8512' });
    expect(g.periodFrom).toBe(g.periodTo);
    // The payment is recorded with the invoice number and can reopen the guide.
    const payment = await prisma.payment.findFirstOrThrow();
    expect(payment).toMatchObject({ orNumber: '28101', invoiceId: saved.body.invoice.id, amount: expect.anything() });
    expect((await cashier.get(`/api/invoices/${saved.body.invoice.id}/guide`)).body.guide).toEqual(g);
  });

  it('puts several months and items on one invoice, with the penalty on its own line', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const c = await customer('Juan Dela Cruz', 1000);
    await prisma.account.update({ where: { id: c.accountId }, data: { membershipStatus: 'PENDING' } });
    const sep = await read(staff, c.connectionId, 1022, month(-1), addDays(today, -40)); // 22 cu.m 510.60, overdue: +51.06
    const oct = await read(staff, c.connectionId, 1045); // 23 cu.m 535.40
    const unit = await prisma.productUnit.findFirstOrThrow();
    const body = invoice(c.accountId, '28102', [
      { type: 'WATER_BILL', waterBillId: sep.id, amount: '561.66' },
      { type: 'WATER_BILL', waterBillId: oct.id, amount: '535.40' },
      { type: 'SALE', items: [{ unitId: unit.id, quantity: 1 }] },
      { type: 'MEMBERSHIP_FEE', amount: '500' },
      { type: 'OTHER', amount: '50', description: 'Certification' },
    ]);
    // Review first: nothing is recorded.
    const preview = await cashier.post('/api/invoices/preview').send(body);
    expect(preview.status).toBe(200);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.invoice.count()).toBe(0);

    const saved = await cashier.post('/api/invoices').send(body);
    expect(saved.status).toBe(201);
    const g = saved.body.guide;
    expect(g.water).toEqual({ present: 1045, previous: 1000, cubicMeters: 45, amount: '1046.00' });
    expect(g.penalty).toBe('51.06');
    expect(g.store).toEqual({ amount: '1550.00', items: ['Dinorado, 1 × per sack (25 kg)'] });
    expect(g.others).toEqual([
      { label: 'Membership Fee', amount: '500.00' },
      { label: 'Others: Certification', amount: '50.00' },
    ]);
    expect(g.totalSales).toBe('3197.06');
    expect(g.totalAmountDue).toBe('3197.06');
    expect(g.amountInWords).toBe('Three Thousand One Hundred Ninety-Seven Pesos and 06/100');
    expect(g.periodFrom).not.toBe(g.periodTo);
    // The review showed exactly what was saved.
    expect({ ...preview.body.guide, number: g.number }).toEqual(g);

    // Five payments on one invoice; the number is shown once.
    const payments = await prisma.payment.findMany({ orderBy: { id: 'asc' } });
    expect(payments.map((p) => p.orNumber)).toEqual(['28102', '28102#2', '28102#3', '28102#4', '28102#5']);
    expect(new Set(payments.map((p) => p.invoiceId)).size).toBe(1);
    const daily = (await cashier.get('/api/reports/daily')).body;
    expect(daily.payments.map((p: { orNumber: string }) => p.orNumber)).toEqual(['28102', '28102', '28102', '28102', '28102']);
    expect(daily.grandTotal).toBe('3197.06');
    expect(daily.orGaps).toEqual([]);
    // The bills are paid, the membership complete, and the bill pop-up knows the invoice.
    expect((await cashier.get(`/api/accounts/${c.accountId}`)).body).toMatchObject({ owed: [], account: { isMember: true } });
    expect((await cashier.get(`/api/water/bills/${sep.id}`)).body.invoices).toEqual([{ id: saved.body.invoice.id, number: '28102', date: today, status: 'ACTIVE' }]);
  });

  it('splits a part payment into water first, then penalty, across two invoices', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const c = await customer('Juan Dela Cruz', 1000);
    const sep = await read(staff, c.connectionId, 1022, month(-1), addDays(today, -40)); // 510.60 + 51.06
    const first = await cashier.post('/api/invoices').send(invoice(c.accountId, '30001', [{ type: 'WATER_BILL', waterBillId: sep.id, amount: '500' }]));
    expect(first.body.guide).toMatchObject({ water: { amount: '500.00' }, penalty: null, totalSales: '500.00' });
    const second = await cashier.post('/api/invoices').send(invoice(c.accountId, '30002', [{ type: 'WATER_BILL', waterBillId: sep.id, amount: '61.66' }]));
    expect(second.body.guide).toMatchObject({ water: { amount: '10.60' }, penalty: '51.06', totalSales: '61.66' });
  });

  it('shows a walk-in and a charge (credit) sale correctly', async () => {
    const admin = await loginAs('ADMIN');
    const unit = await prisma.productUnit.findFirstOrThrow();
    const walk = await admin.post('/api/invoices').send(invoice(null, '30010', [{ type: 'SALE', items: [{ unitId: unit.id, quantity: 2 }] }], { walkInName: 'Aling Nena' }));
    expect(walk.body.guide).toMatchObject({ registeredName: 'Aling Nena', tin: '', water: null, store: { amount: '3100.00' }, totalAmountDue: '3100.00' });
    expect((await admin.post('/api/invoices').send(invoice(null, '30011', [{ type: 'OTHER', amount: '5', description: 'x' }]))).status).toBe(400);

    await admin.put('/api/settings').send({ allow_credit: 'true' });
    const c = await customer();
    const charge = await admin.post('/api/invoices').send(invoice(c.accountId, '30012', [{ type: 'SALE', items: [{ unitId: unit.id, quantity: 1 }] }], { credit: true }));
    expect(charge.body.guide).toMatchObject({ cashSales: false, chargeSales: true, store: { amount: '1550.00' }, totalAmountDue: '1550.00' });
    expect(await prisma.payment.count({ where: { invoiceId: charge.body.invoice.id } })).toBe(0);
  });
});

describe('invoice numbers', () => {
  it('blocks a number already used (invoice, cancelled invoice, or an older payment)', async () => {
    const staff = await loginAs('STAFF');
    const admin = await loginAs('ADMIN');
    const c = await customer();
    const bill = await read(staff, c.connectionId, 262);
    const one = await admin.post('/api/invoices').send(invoice(c.accountId, '28101', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    const dup = await admin.post('/api/invoices').send(invoice(c.accountId, ' 28101 ', [{ type: 'WATER_BILL', waterBillId: bill.id, amount: '100' }]));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/Invoice No\. 28101 was already used for Marcelo Gandiola/);

    await admin.post(`/api/invoices/${one.body.invoice.id}/cancel`).send({ reason: 'Spoiled invoice' });
    const again = await admin.post('/api/invoices').send(invoice(c.accountId, '28101', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/cancelled/);
    // A later payment's internal number ("#2") is never offered as an invoice number.
    expect((await admin.get('/api/invoices/check').query({ number: '28101' })).body.used).toMatch(/already used/);
    // Nothing half-saved: the bill is still unpaid.
    expect((await admin.get(`/api/accounts/${c.accountId}`)).body.owed).toHaveLength(1);
  });

  it('only one of two simultaneous saves with the same number gets through', async () => {
    const cashier = await loginAs('CASHIER');
    const c = await customer();
    const body = invoice(c.accountId, '29000', [{ type: 'OTHER', amount: '10', description: 'Form' }]);
    const results = await Promise.all([cashier.post('/api/invoices').send(body), cashier.post('/api/invoices').send(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.invoice.count()).toBe(1);
  });

  it('warns, but still saves, a number outside the approved series', async () => {
    const cashier = await loginAs('CASHIER');
    const c = await customer();
    const check = async (n: string) => (await cashier.get('/api/invoices/check').query({ number: n })).body;
    expect((await check('28101')).warning).toBeNull();
    expect((await check('41000')).warning).toMatch(/outside the approved series \(25,001 to 40,000\)/);
    expect((await check('A-12')).warning).toMatch(/not a plain number/);
    const preview = await cashier.post('/api/invoices/preview').send(invoice(c.accountId, '41000', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    expect(preview.body.check.warning).toMatch(/outside/);
    expect((await cashier.post('/api/invoices').send(invoice(c.accountId, '41000', [{ type: 'OTHER', amount: '10', description: 'Form' }]))).status).toBe(201);
  });

  it("suggests each cashier's last number + 1, and counts the numbers left", async () => {
    const cashier = await loginAs('CASHIER');
    const admin = await loginAs('ADMIN');
    const c = await customer();
    expect((await cashier.get('/api/invoices/suggest')).body.next).toBe('');
    await cashier.post('/api/invoices').send(invoice(c.accountId, '28101', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    await admin.post('/api/invoices').send(invoice(c.accountId, '35000', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    expect((await cashier.get('/api/invoices/suggest')).body.next).toBe('28102');
    expect((await admin.get('/api/invoices/suggest')).body.next).toBe('35001');

    let home = (await admin.get('/api/reports/home')).body.invoices;
    expect(home).toEqual({ remaining: 5000, to: 40000, low: false });
    await admin.post('/api/invoices').send(invoice(c.accountId, '38500', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    home = (await admin.get('/api/reports/home')).body.invoices;
    expect(home).toEqual({ remaining: 1500, to: 40000, low: true });
  });

  it('flags gaps in invoice numbers on the Daily Collection Report', async () => {
    const cashier = await loginAs('CASHIER');
    const c = await customer();
    for (const n of ['28101', '28102', '28104']) {
      await cashier.post('/api/invoices').send(invoice(c.accountId, n, [{ type: 'OTHER', amount: '10', description: 'Form' }, { type: 'OTHER', amount: '5', description: 'Copy' }]));
    }
    const daily = (await cashier.get('/api/reports/daily')).body;
    expect(daily.orGaps).toMatchObject([{ after: '28102', before: '28104', missing: ['28103'] }]);
  });
});

describe('cancelling an invoice', () => {
  it('voids every payment on it, puts the bills back to unpaid, and keeps the number used', async () => {
    const staff = await loginAs('STAFF');
    const admin = await loginAs('ADMIN');
    const c = await customer('Juan Dela Cruz', 1000);
    const sep = await read(staff, c.connectionId, 1010, month(-1), addDays(today, -20));
    const oct = await read(staff, c.connectionId, 1020);
    const saved = await admin.post('/api/invoices').send(
      invoice(c.accountId, '28101', [
        { type: 'WATER_BILL', waterBillId: sep.id, amount: '186.50' },
        { type: 'WATER_BILL', waterBillId: oct.id, amount: '186.50' },
      ]),
    );
    // Voiding one payment from the payment details cancels the whole invoice.
    const second = await prisma.payment.findFirstOrThrow({ where: { orNumber: '28101#2' } });
    expect((await admin.post(`/api/payments/${second.id}/void`).send({ reason: 'Wrong account' })).status).toBe(200);
    expect(await prisma.payment.count({ where: { status: 'ACTIVE' } })).toBe(0);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: saved.body.invoice.id } });
    expect(inv).toMatchObject({ status: 'VOID', cancelReason: 'Wrong account' });
    expect((await admin.get(`/api/accounts/${c.accountId}`)).body.owed).toHaveLength(2);
    const g = (await admin.get(`/api/invoices/${inv.id}/guide`)).body.guide;
    expect(g).toMatchObject({ cancelled: true, cancelReason: 'Wrong account', totalAmountDue: '373.00' });
    expect((await admin.post(`/api/invoices/${inv.id}/cancel`).send({ reason: 'again' })).status).toBe(400);
    expect((await admin.get('/api/reports/daily')).body.grandTotal).toBe('0.00');
  });

  it('is for an Admin only; the cashier records, everyone can view a guide', async () => {
    const cashier = await loginAs('CASHIER');
    const c = await customer();
    const saved = await cashier.post('/api/invoices').send(invoice(c.accountId, '28101', [{ type: 'OTHER', amount: '10', description: 'Form' }]));
    expect((await cashier.post(`/api/invoices/${saved.body.invoice.id}/cancel`).send({ reason: 'x' })).status).toBe(403);
    for (const role of ['STAFF', 'BOARD'] as const) {
      const user = await loginAs(role);
      expect((await user.post('/api/invoices').send(invoice(c.accountId, '28200', [{ type: 'OTHER', amount: '10', description: 'Form' }]))).status).toBe(403);
      expect((await user.post('/api/invoices/preview').send(invoice(c.accountId, '28200', [{ type: 'OTHER', amount: '10', description: 'Form' }]))).status).toBe(403);
      expect((await user.get(`/api/invoices/${saved.body.invoice.id}/guide`)).status).toBe(200);
    }
  });

  it('refuses the same bill twice and an empty invoice', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const c = await customer();
    const bill = await read(staff, c.connectionId, 262);
    const twice = await cashier.post('/api/invoices').send(invoice(c.accountId, '1', [{ type: 'WATER_BILL', waterBillId: bill.id, amount: '100' }, { type: 'WATER_BILL', waterBillId: bill.id, amount: '100' }]));
    expect(twice.body.error).toMatch(/twice/);
    expect((await cashier.post('/api/invoices').send(invoice(c.accountId, '1', []))).status).toBe(400);
    expect((await cashier.post('/api/invoices').send(invoice(c.accountId, '', [{ type: 'OTHER', amount: '10', description: 'x' }]))).body.error).toMatch(/Invoice No/);
  });
});
