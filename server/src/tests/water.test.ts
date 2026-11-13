import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila, toDbDate } from '../lib/dates';
import { addDays, addMonths, periodOf } from '../lib/periods';
import { APPROVED_TARIFF, computeWaterCharge, type RateTerms } from '../services/rates';
import { billState } from '../services/water';
import { loginAs, makeAccount, resetDb } from './helpers';

const RES: RateTerms = { ...APPROVED_TARIFF.RESIDENTIAL, method: 'BLOCK' };
const COM: RateTerms = { ...APPROVED_TARIFF.COMMERCIAL, method: 'BLOCK' };
const charge = (m3: number, terms = RES) => computeWaterCharge(m3, terms).toFixed(2);

describe('bill computation', () => {
  it("matches IWMPC's customer card (Villalon, 2026)", () => {
    // cu.m -> amount, exactly as written on the paper card.
    const card: [number, string][] = [
      [18, '365.90'],
      [22, '510.60'],
      [23, '535.40'],
      [24, '560.20'],
      [25, '585.00'],
      [26, '609.80'],
      [28, '659.40'],
    ];
    for (const [m3, amount] of card) expect(charge(m3)).toBe(amount);
  });

  it('charges only the minimum for the first 5 cu.m', () => {
    expect(charge(0)).toBe('89.00');
    expect(charge(5)).toBe('89.00');
  });

  it('uses the rate of the block the consumption falls in', () => {
    expect(charge(6)).toBe('108.50'); // 89 + 1 x 19.50
    expect(charge(10)).toBe('186.50'); // 89 + 5 x 19.50
    expect(charge(11)).toBe('216.80'); // 89 + 6 x 21.30
    expect(charge(20)).toBe('408.50'); // 89 + 15 x 21.30
    expect(charge(21)).toBe('485.80'); // 89 + 16 x 24.80
    expect(charge(31)).toBe('824.80'); // 89 + 26 x 28.30
    expect(charge(45)).toBe('1365.00'); // 89 + 40 x 31.90
  });

  it('computes Commercial & Industrial bills', () => {
    expect(charge(15, COM)).toBe('531.00');
    expect(charge(16, COM)).toBe('580.60'); // 531 + 1 x 49.60
    expect(charge(600, COM)).toBe('52420.50'); // 531 + 585 x 88.70
    expect(charge(1001, COM)).toBe('98440.80'); // 531 + 986 x 99.30
  });

  it('can also charge each block at its own rate (progressive)', () => {
    // 89 + 5 x 19.50 + 10 x 21.30 + 2 x 24.80
    expect(charge(22, { ...RES, method: 'PROGRESSIVE' })).toBe('449.10');
    expect(charge(5, { ...RES, method: 'PROGRESSIVE' })).toBe('89.00');
    // 89 + 5 x 19.50 + 10 x 21.30 + 10 x 24.80 + 10 x 28.30 + 5 x 31.90
    expect(charge(45, { ...RES, method: 'PROGRESSIVE' })).toBe('1090.00');
  });
});

describe('bill status and penalty', () => {
  const D = (n: number) => new Prisma.Decimal(n);
  const bill = { amount: D(560.2), penaltyAmount: D(56.02), dueDate: toDbDate('2026-06-15') };
  const pay = (amount: number, date: string, status: 'ACTIVE' | 'VOID' = 'ACTIVE') => ({
    amount: D(amount),
    paymentDate: toDbDate(date),
    status,
    orNumber: `OR-${date}`,
  });

  it('is Unpaid, then Due soon within 5 days, then Overdue with the penalty', () => {
    expect(billState(bill, [], '2026-06-01')).toMatchObject({ status: 'UNPAID' });
    expect(billState(bill, [], '2026-06-10').status).toBe('DUE_SOON');
    expect(billState(bill, [], '2026-06-15').status).toBe('DUE_SOON');
    const late = billState(bill, [], '2026-06-16');
    expect(late.status).toBe('OVERDUE');
    expect(late.penalty.toFixed(2)).toBe('56.02');
    expect(late.balance.toFixed(2)).toBe('616.22');
  });

  it('has no penalty when paid in full on or before the due date', () => {
    const state = billState(bill, [pay(560.2, '2026-06-15')], '2026-08-01');
    expect(state).toMatchObject({ status: 'PAID', datePaid: '2026-06-15', orNumbers: ['OR-2026-06-15'] });
    expect(state.penalty.toFixed(2)).toBe('0.00');
  });

  it('keeps the penalty when paid late, until the penalty is paid too', () => {
    const lateOnly = billState(bill, [pay(560.2, '2026-06-20')], '2026-08-01');
    expect(lateOnly.status).toBe('OVERDUE');
    expect(lateOnly.balance.toFixed(2)).toBe('56.02');
    expect(billState(bill, [pay(560.2, '2026-06-20'), pay(56.02, '2026-06-21')], '2026-08-01').status).toBe('PAID');
  });

  it('charges the penalty when only part was paid on time', () => {
    const state = billState(bill, [pay(300, '2026-06-10')], '2026-06-20');
    expect(state.balance.toFixed(2)).toBe('316.22');
  });

  it('ignores voided payments', () => {
    expect(billState(bill, [pay(560.2, '2026-06-10', 'VOID')], '2026-06-12')).toMatchObject({ status: 'DUE_SOON', orNumbers: [] });
  });
});

// ---- through the API -------------------------------------------------------------------------

const today = todayManila();
const THIS = periodOf(today);
const LAST = addMonths(THIS, -1);

async function setup(initialReading = 1720) {
  const account = await makeAccount('Joselito Villalon', 'ACTIVE');
  const connection = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: account.id } });
  await prisma.waterConnection.update({ where: { id: connection.id }, data: { initialReading } });
  return { account, connectionId: connection.id };
}

const read = (connectionId: number, currentReading: number, period = THIS, readDate = today) => ({
  period,
  readDate,
  readings: [{ connectionId, currentReading }],
});

const waterPayment = (accountId: number, amount: string, orNumber: string, waterBillId?: number) => ({
  accountId,
  type: 'WATER_BILL',
  amount,
  orNumber,
  waterBillId,
});

beforeEach(resetDb);

describe('meter readings and bills', () => {
  it('creates the bill from the reading, like a row on the customer card', async () => {
    const staff = await loginAs('STAFF');
    const { account, connectionId } = await setup(1720);

    const sheet = await staff.get('/api/water/readings').query({ period: THIS });
    expect(sheet.body.rows).toMatchObject([{ connectionId, name: 'Joselito Villalon', previousReading: 1720, currentReading: null }]);
    expect(sheet.body.rates.RESIDENTIAL.minimumCharge).toBe('89.00');

    const saved = await staff.post('/api/water/readings').send(read(connectionId, 1743));
    expect(saved.body).toEqual({ saved: 1, unchanged: 0, problems: [] });

    const profile = await staff.get(`/api/accounts/${account.id}`);
    expect(profile.body.bills).toMatchObject([
      {
        period: THIS,
        previousReading: 1720,
        currentReading: 1743,
        cubicMeters: 23,
        amount: '535.40',
        penalty: '0.00',
        balance: '535.40',
        dueDate: addDays(today, 15),
        status: 'UNPAID',
        orNumbers: [],
      },
    ]);
    expect(profile.body.water).toMatchObject({ totalDue: '535.40', status: 'UNPAID', nextDueDate: addDays(today, 15) });
    expect(profile.body.owed).toMatchObject([{ type: 'WATER_BILL', amount: '535.40' }]);
  });

  it('uses last month as the previous reading, and bills a lower reading as no use', async () => {
    const staff = await loginAs('STAFF');
    const { account, connectionId } = await setup(1720);
    await staff.post('/api/water/readings').send(read(connectionId, 1743, LAST, addDays(today, -30)));
    const sheet = await staff.get('/api/water/readings').query({ period: THIS });
    expect(sheet.body.rows[0]).toMatchObject({ previousReading: 1743, usualUsage: 23 });

    // Lower than the previous reading (e.g. the meter was replaced): a warning on screen, still saved.
    await staff.post('/api/water/readings').send(read(connectionId, 12));
    const bills = (await staff.get(`/api/accounts/${account.id}`)).body.bills;
    expect(bills[0]).toMatchObject({ period: THIS, previousReading: 1743, currentReading: 12, cubicMeters: 0, amount: '89.00' });
  });

  it('lets staff correct the latest reading until the bill has a payment', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const { account, connectionId } = await setup(1720);
    await staff.post('/api/water/readings').send(read(connectionId, 1743, LAST, addDays(today, -30)));
    await staff.post('/api/water/readings').send(read(connectionId, 1761));

    // An earlier month cannot be changed once a later month was read.
    const old = await staff.post('/api/water/readings').send(read(connectionId, 1750, LAST, addDays(today, -30)));
    expect(old.body.saved).toBe(0);
    expect(old.body.problems[0]).toMatch(/cannot be changed/);

    // The latest one can: 1761 was a typo for 1765.
    expect((await staff.post('/api/water/readings').send(read(connectionId, 1765))).body.saved).toBe(1);
    expect((await staff.post('/api/water/readings').send(read(connectionId, 1765))).body).toMatchObject({ saved: 0, unchanged: 1 });
    let bills = (await staff.get(`/api/accounts/${account.id}`)).body.bills;
    expect(bills[0]).toMatchObject({ cubicMeters: 22, amount: '510.60' });
    expect(await prisma.waterBill.count()).toBe(2);

    await cashier.post('/api/payments').send(waterPayment(account.id, '100', '5001', bills[0].id));
    const locked = await staff.post('/api/water/readings').send(read(connectionId, 1770));
    expect(locked.body.problems[0]).toMatch(/already has a payment/);
    bills = (await staff.get(`/api/accounts/${account.id}`)).body.bills;
    expect(bills[0].currentReading).toBe(1765);
  });

  it('refuses bad readings and is for Staff and Admin only', async () => {
    const staff = await loginAs('STAFF');
    const { connectionId } = await setup();
    expect((await staff.post('/api/water/readings').send(read(connectionId, -1))).status).toBe(400);
    expect((await staff.post('/api/water/readings').send(read(connectionId, 10.5))).status).toBe(400);
    expect((await staff.post('/api/water/readings').send(read(connectionId, 1800, THIS, addDays(today, 1)))).status).toBe(400);
    expect((await staff.post('/api/water/readings').send(read(connectionId, 1800, '2026-13'))).status).toBe(400);
    for (const role of ['CASHIER', 'BOARD'] as const) {
      expect((await (await loginAs(role)).post('/api/water/readings').send(read(connectionId, 1800))).status).toBe(403);
    }
    expect(await prisma.waterBill.count()).toBe(0);
  });
});

describe('paying water bills', () => {
  it('marks the bill Paid and puts the OR number on the card', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const { account, connectionId } = await setup(1720);
    await staff.post('/api/water/readings').send(read(connectionId, 1743));

    // No bill picked: the oldest unpaid bill is paid.
    const paid = await cashier.post('/api/payments').send(waterPayment(account.id, '535.40', '17194'));
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ type: 'WATER_BILL', waterBillPeriod: THIS });

    const profile = await cashier.get(`/api/accounts/${account.id}`);
    expect(profile.body.bills[0]).toMatchObject({ status: 'PAID', balance: '0.00', datePaid: today, orNumbers: ['17194'] });
    expect(profile.body.owed).toEqual([]);
    expect(profile.body.water).toMatchObject({ totalDue: '0.00', status: 'PAID' });

    const report = await cashier.get('/api/reports/daily');
    expect(report.body.totals).toEqual([{ type: 'WATER_BILL', count: 1, total: '535.40' }]);
  });

  it('allows part payments, blocks paying more than is owed, and needs an unpaid bill', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const { account, connectionId } = await setup(1720);
    const none = await cashier.post('/api/payments').send(waterPayment(account.id, '100', '1'));
    expect(none.body.error).toBe('This account has no unpaid water bill.');

    await staff.post('/api/water/readings').send(read(connectionId, 1743));
    expect((await cashier.post('/api/payments').send(waterPayment(account.id, '200', '2'))).status).toBe(201);
    let bill = (await cashier.get(`/api/accounts/${account.id}`)).body.bills[0];
    expect(bill).toMatchObject({ status: 'UNPAID', paid: '200.00', balance: '335.40' });

    const tooMuch = await cashier.post('/api/payments').send(waterPayment(account.id, '400', '3'));
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/more than what is owed/);

    await cashier.post('/api/payments').send(waterPayment(account.id, '335.40', '4'));
    bill = (await cashier.get(`/api/accounts/${account.id}`)).body.bills[0];
    expect(bill).toMatchObject({ status: 'PAID', orNumbers: ['2', '4'] });
    expect((await cashier.post('/api/payments').send(waterPayment(account.id, '1', '5'))).status).toBe(400);
  });

  it("refuses a bill that belongs to another account", async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const { account, connectionId } = await setup();
    await staff.post('/api/water/readings').send(read(connectionId, 1743));
    const billId = (await staff.get(`/api/accounts/${account.id}`)).body.bills[0].id;
    const other = await makeAccount('Maria Santos');
    const res = await cashier.post('/api/payments').send(waterPayment(other.id, '100', '9', billId));
    expect(res.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('goes back to unpaid when the payment is voided', async () => {
    const admin = await loginAs('ADMIN');
    const { account, connectionId } = await setup(1720);
    await admin.post('/api/water/readings').send(read(connectionId, 1743));
    const payment = await admin.post('/api/payments').send(waterPayment(account.id, '535.40', '17194'));
    await admin.post(`/api/payments/${payment.body.id}/void`).send({ reason: 'Wrong account' });

    const profile = await admin.get(`/api/accounts/${account.id}`);
    expect(profile.body.bills[0]).toMatchObject({ status: 'UNPAID', balance: '535.40', orNumbers: [], datePaid: null });
    expect(profile.body.owed).toHaveLength(1);
  });
});

describe('overdue bills', () => {
  it('adds the 10% penalty after the due date and lists the account as overdue', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const { account, connectionId } = await setup(1808);
    // Read 40 days ago, due 25 days ago.
    await staff.post('/api/water/readings').send(read(connectionId, 1832, LAST, addDays(today, -40)));

    const profile = await staff.get(`/api/accounts/${account.id}`);
    expect(profile.body.bills[0]).toMatchObject({ cubicMeters: 24, amount: '560.20', penalty: '56.02', balance: '616.22', status: 'OVERDUE' });

    const home = await staff.get('/api/reports/home');
    expect(home.body.overdueWater).toEqual({ count: 1, total: '616.22' });

    const list = await staff.get('/api/water/overdue');
    expect(list.body.rows).toMatchObject([{ name: 'Joselito Villalon', months: 1, amount: '616.22', disconnectionCandidate: false }]);
    expect(list.body.total).toBe('616.22');
    expect((await staff.get('/api/water/overdue').query({ areaId: 2 })).body.rows).toEqual([]);

    // Paying only the bill amount late leaves the penalty owed.
    await cashier.post('/api/payments').send(waterPayment(account.id, '560.20', '21532'));
    expect((await staff.get(`/api/accounts/${account.id}`)).body.bills[0]).toMatchObject({ status: 'OVERDUE', balance: '56.02' });
    await cashier.post('/api/payments').send(waterPayment(account.id, '56.02', '21533'));
    expect((await staff.get(`/api/accounts/${account.id}`)).body.bills[0]).toMatchObject({ status: 'PAID', penalty: '56.02' });
    expect((await staff.get('/api/water/overdue')).body.rows).toEqual([]);
  });

  it('flags disconnection candidates after the number of unpaid months in Settings, and shows the previous balance on the bill', async () => {
    const staff = await loginAs('STAFF');
    const { account, connectionId } = await setup(1000);
    await staff.post('/api/water/readings').send(read(connectionId, 1010, addMonths(THIS, -2), addDays(today, -75)));
    await staff.post('/api/water/readings').send(read(connectionId, 1020, LAST, addDays(today, -45)));
    await staff.post('/api/water/readings').send(read(connectionId, 1030));

    const list = await staff.get('/api/water/overdue');
    expect(list.body.threshold).toBe(2);
    expect(list.body.rows).toMatchObject([{ months: 2, disconnectionCandidate: true }]);
    // Nothing is disconnected automatically.
    expect((await prisma.waterConnection.findUniqueOrThrow({ where: { id: connectionId } })).status).toBe('ACTIVE');

    const bills = (await staff.get(`/api/accounts/${account.id}`)).body.bills;
    const notice = await staff.get(`/api/water/bills/${bills[0].id}`);
    // Two overdue months of 10 cu.m: (186.50 + 18.65) x 2
    expect(notice.body).toMatchObject({ previousBalance: '410.30', totalDue: '596.80', penaltyIfLate: '18.65' });
    expect(notice.body.previousMonths).toHaveLength(2);
  });

  it('filters the Accounts list by water bill status and shows the month strip', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const late = await setup(100);
    await staff.post('/api/water/readings').send(read(late.connectionId, 110, LAST, addDays(today, -40)));
    const paid = await makeAccount('Paid Person', 'ACTIVE');
    const paidConn = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: paid.id } });
    await staff.post('/api/water/readings').send(read(paidConn.id, 10));
    await cashier.post('/api/payments').send(waterPayment(paid.id, '186.50', '7001'));
    const soon = await makeAccount('Soon Person', 'ACTIVE');
    const soonConn = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: soon.id } });
    await staff.post('/api/water/readings').send(read(soonConn.id, 3, THIS, addDays(today, -12))); // due in 3 days
    await makeAccount('No Bills');

    const names = async (water: string) =>
      (await staff.get('/api/accounts').query({ water })).body.rows.map((r: { fullName: string }) => r.fullName);
    expect(await names('overdue')).toEqual(['Joselito Villalon']);
    expect(await names('paid')).toEqual(['Paid Person']);
    expect(await names('due-soon')).toEqual(['Soon Person']);
    expect(await names('')).toHaveLength(4);

    const all = await staff.get('/api/accounts');
    expect(all.body.months).toHaveLength(12);
    expect(all.body.months[11]).toBe(THIS);
    const row = (name: string) => all.body.rows.find((r: { fullName: string }) => r.fullName === name).water;
    expect(row('Joselito Villalon')).toMatchObject({ current: { period: LAST, status: 'OVERDUE', balance: '205.15' }, previousUnpaid: '0.00' });
    expect(row('Joselito Villalon').months[10]).toMatchObject({ period: LAST, status: 'UNPAID' });
    expect(row('Paid Person').months[11]).toMatchObject({ status: 'PAID', amount: '186.50', datePaid: today });
    expect(row('No Bills')).toMatchObject({ current: null });
    expect(row('No Bills').months.every((m: { status: string }) => m.status === 'NONE')).toBe(true);
  });
});

describe('changing the rates', () => {
  const NEXT = addMonths(THIS, 1);
  const newRates = {
    rateClass: 'RESIDENTIAL',
    effectiveFrom: NEXT,
    minimumCharge: '100',
    minimumCoversM3: 5,
    tiers: [
      { upTo: 10, rate: '25' },
      { upTo: null, rate: '30' },
    ],
  };

  it('does not change bills that were already made', async () => {
    const admin = await loginAs('ADMIN');
    const { account, connectionId } = await setup(1720);
    await admin.post('/api/water/readings').send(read(connectionId, 1743));

    expect((await admin.post('/api/water/rates').send(newRates)).status).toBe(201);
    // The penalty and due-date settings are changed too.
    await admin.put('/api/settings').send({ water_penalty_type: 'FIXED', water_penalty_value: '50', water_due_days: '5' });

    const before = (await admin.get(`/api/accounts/${account.id}`)).body.bills[0];
    expect(before).toMatchObject({ amount: '535.40', dueDate: addDays(today, 15) });
    expect((await prisma.waterBill.findFirstOrThrow()).penaltyAmount.toFixed(2)).toBe('53.54');

    // This month still uses the old rates (even when corrected); next month uses the new ones.
    await admin.post('/api/water/readings').send(read(connectionId, 1744));
    expect((await admin.get(`/api/accounts/${account.id}`)).body.bills[0]).toMatchObject({ cubicMeters: 24, amount: '560.20' });

    const rates = await admin.get('/api/water/rates');
    const residential = rates.body.classes.find((c: { rateClass: string }) => c.rateClass === 'RESIDENTIAL');
    expect(residential.current.minimumCharge).toBe('89.00');
    expect(residential.versions.map((v: { effectiveFrom: string }) => v.effectiveFrom)).toEqual([NEXT, '2022-07']);
    const sheet = await admin.get('/api/water/readings').query({ period: NEXT });
    expect(sheet.body.rates.RESIDENTIAL.minimumCharge).toBe('100.00');
    expect(sheet.body.rates.COMMERCIAL.minimumCharge).toBe('531.00');
  });

  it('must start after the last month that was billed, and is Admin only', async () => {
    const admin = await loginAs('ADMIN');
    const { connectionId } = await setup(1720);
    await admin.post('/api/water/readings').send(read(connectionId, 1743));

    const backdated = await admin.post('/api/water/rates').send({ ...newRates, effectiveFrom: THIS });
    expect(backdated.status).toBe(409);
    expect(backdated.body.error).toMatch(/must start in a later month/);
    // Commercial has no bills yet, so its rates may start this month.
    expect((await admin.post('/api/water/rates').send({ ...newRates, rateClass: 'COMMERCIAL', effectiveFrom: THIS })).status).toBe(201);

    const badBlocks = { ...newRates, tiers: [{ upTo: 10, rate: '25' }, { upTo: 8, rate: '30' }, { upTo: null, rate: '31' }] };
    expect((await admin.post('/api/water/rates').send(badBlocks)).status).toBe(400);
    expect((await admin.post('/api/water/rates').send({ ...newRates, tiers: [{ upTo: 10, rate: '25' }] })).status).toBe(400);
    expect((await admin.post('/api/water/rates').send({ ...newRates, minimumCharge: 'abc' })).status).toBe(400);
    expect((await (await loginAs('STAFF')).post('/api/water/rates').send(newRates)).status).toBe(403);
    expect(await prisma.rateSchedule.count()).toBe(3);
  });
});
