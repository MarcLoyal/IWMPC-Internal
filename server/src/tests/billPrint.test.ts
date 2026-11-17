import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila } from '../lib/dates';
import { addDays, addMonths, dueDateFor, periodOf } from '../lib/periods';
import { loginAs, makeAccount, resetDb } from './helpers';

const today = todayManila();
const THIS = periodOf(today);
const month = (n: number) => addMonths(THIS, n);

beforeEach(resetDb);

/** An account with one active connection whose meter starts at `start`. */
async function customer(name: string, areaId = 1, start = 1000, serial = '') {
  const account = await makeAccount(name, 'ACTIVE');
  await prisma.account.update({ where: { id: account.id }, data: { areaId, purok: 'GK Eco Village' } });
  const c = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: account.id } });
  await prisma.waterConnection.update({ where: { id: c.id }, data: { initialReading: start, meterName: 'Meco', meterSerial: serial } });
  return { accountId: account.id, connectionId: c.id };
}

async function read(staff: Awaited<ReturnType<typeof loginAs>>, connectionId: number, current: number, period = THIS, readDate = today) {
  const res = await staff.post('/api/water/readings').send({ period, readDate, readings: [{ connectionId, currentReading: current }] });
  expect(res.body.saved).toBe(1);
}

const bills = async (user: Awaited<ReturnType<typeof loginAs>>, query: Record<string, string | number> = {}) =>
  (await user.get('/api/water/print/bills').query({ period: THIS, ...query })).body;

describe('what is printed on each bill', () => {
  it('matches the account: current month, unpaid earlier months with penalty, and the total', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await customer('Juan Dela Cruz', 1, 1000, '19-007508');
    await read(staff, juan.connectionId, 1010, month(-3), addDays(today, -100)); // paid, must not appear
    await read(staff, juan.connectionId, 1024, month(-2), addDays(today, -70)); // unpaid, overdue
    await read(staff, juan.connectionId, 1046, month(-1), addDays(today, -40)); // unpaid, overdue
    await read(staff, juan.connectionId, 1069); // this month: 23 cu.m
    const paidBill = await prisma.waterBill.findFirstOrThrow({ where: { period: month(-3) } });
    await cashier.post('/api/payments').send({ accountId: juan.accountId, type: 'WATER_BILL', amount: '205.15', orNumber: '9001', waterBillId: paidBill.id }); // paid late, penalty included

    const { bills: printed, header } = await bills(staff);
    expect(printed).toHaveLength(1);
    const bill = printed[0];
    expect(bill).toMatchObject({ accountName: 'Juan Dela Cruz', address: 'NARRA/GK ECO VILLAGE', meterNo: 'Meco # 19-007508', period: THIS });
    // 14 cu.m = 89 + 9 x 21.30 = 280.70 (+10% = 28.07); 22 cu.m = 510.60 (+51.06); this month 23 cu.m = 535.40
    expect(bill.rows).toEqual([
      { kind: 'EARLIER', month: expect.stringMatching(/^\w{3} \d{4}$/), cubicMeters: 14, amount: '308.77', withPenalty: true },
      { kind: 'EARLIER', month: expect.any(String), cubicMeters: 22, amount: '561.66', withPenalty: true },
      { kind: 'CURRENT', month: expect.any(String), cubicMeters: 23, amount: '535.40', withPenalty: false },
    ]);
    expect(bill.totalDue).toBe('1405.83');

    // Exactly what the account shows as owed.
    const profile = await staff.get(`/api/accounts/${juan.accountId}`);
    expect(profile.body.water.totalDue).toBe(bill.totalDue);
    const current = profile.body.bills.find((b: { period: string }) => b.period === THIS);
    expect(current.amount).toBe('535.40');
    expect(header.coopName).toBe('INICBULAN WATERWORKS MULTI-PURPOSE COOPERATIVE');
  });

  it('shows a part payment on this month and still adds up exactly', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const maria = await customer('Maria Santos');
    await read(staff, maria.connectionId, 1023);
    await cashier.post('/api/payments').send({ accountId: maria.accountId, type: 'WATER_BILL', amount: '200', orNumber: '9002' });
    const bill = (await bills(staff)).bills[0];
    expect(bill.rows.map((r: { kind: string; amount: string }) => [r.kind, r.amount])).toEqual([
      ['CURRENT', '535.40'],
      ['PAYMENT', '-200.00'],
    ]);
    expect(bill.totalDue).toBe('335.40');
  });

  it('puts more than 5 unpaid earlier months into one combined row, keeping the total exact', async () => {
    const staff = await loginAs('STAFF');
    const pedro = await customer('Pedro Bautista');
    for (let i = 8; i >= 1; i--) await read(staff, pedro.connectionId, 1000 + (9 - i) * 10, month(-i), addDays(today, -i * 31 - 5));
    await read(staff, pedro.connectionId, 1090);
    const bill = (await bills(staff)).bills[0];
    expect(bill.rows.map((r: { kind: string }) => r.kind)).toEqual(['COMBINED', 'EARLIER', 'EARLIER', 'EARLIER', 'EARLIER', 'EARLIER', 'CURRENT']);
    expect(bill.rows[0]).toMatchObject({ month: expect.stringMatching(/^\w{3}-\w{3} \d{4}$|^\w{3} \d{4}-\w{3} \d{4}$/), cubicMeters: 30, withPenalty: true });
    // 8 overdue months of 10 cu.m (186.50 + 18.65 penalty) + this month's 186.50
    expect(bill.totalDue).toBe((8 * 205.15 + 186.5).toFixed(2));
    const owed = (await staff.get(`/api/accounts/${(await prisma.waterConnection.findUniqueOrThrow({ where: { id: pedro.connectionId } })).accountId}`)).body.water.totalDue;
    expect(owed).toBe(bill.totalDue);
  });
});

describe('choosing which bills to print', () => {
  async function three() {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const a = await customer('Ana Narra', 1, 1000, '19-000300');
    const b = await customer('Ben Ipil', 2, 1000, '19-000100');
    const c = await customer('Carla Narra', 1, 1000, '19-000200');
    for (const x of [a, b, c]) await read(staff, x.connectionId, 1010);
    // Carla has paid.
    await cashier.post('/api/payments').send({ accountId: c.accountId, type: 'WATER_BILL', amount: '186.50', orNumber: '9100' });
    // An active connection with no reading this month.
    await customer('Dan NoReading', 2);
    return staff;
  }

  it('filters by area and by unpaid only, and sorts by area then name or by meter number', async () => {
    const staff = await three();
    const names = async (q: Record<string, string>) => (await bills(staff, q)).bills.map((b: { accountName: string }) => b.accountName);
    expect(await names({})).toEqual(['Ana Narra', 'Carla Narra', 'Ben Ipil']);
    expect(await names({ areaIds: '2' })).toEqual(['Ben Ipil']);
    expect(await names({ areaIds: '1,2', which: 'unpaid' })).toEqual(['Ana Narra', 'Ben Ipil']);
    expect(await names({ sort: 'meter' })).toEqual(['Ben Ipil', 'Carla Narra', 'Ana Narra']);
    // A paid bill still prints with "All bills", with a total of zero.
    const carla = (await bills(staff)).bills[1];
    expect(carla.totalDue).toBe('0.00');
  });

  it('gives a summary: bills per area, pages, and connections with no reading', async () => {
    const staff = await three();
    const s = (await staff.get('/api/water/print/summary')).body;
    expect(s).toMatchObject({ period: THIS, bills: 3, pages: 1, pagesPerArea: 2 });
    expect(s.byArea).toEqual([
      { id: 1, name: 'Narra', bills: 2, monthly: 2, notices: 0 },
      { id: 2, name: 'Ipil', bills: 1, monthly: 1, notices: 0 },
    ]);
    expect(s.missing).toMatchObject([{ name: 'Dan NoReading', area: 'Ipil' }]);
    expect(s.periods[0]).toBe(THIS);
    expect((await staff.get('/api/water/print/summary').query({ areaIds: '1' })).body.missing).toEqual([]);
    expect((await staff.get('/api/water/print/summary').query({ which: 'unpaid' })).body.bills).toBe(2);
  });

  it('counts pages at 4 bills a page', async () => {
    const staff = await loginAs('STAFF');
    for (let i = 0; i < 9; i++) {
      const x = await customer(`Person ${i}`);
      await read(staff, x.connectionId, 1005);
    }
    const s = (await staff.get('/api/water/print/summary')).body;
    expect([s.bills, s.pages]).toEqual([9, 3]);
    // Paging through the bills returns each one exactly once.
    const first = await bills(staff, { limit: 4 });
    const second = await bills(staff, { limit: 4, offset: 4 });
    const third = await bills(staff, { limit: 4, offset: 8 });
    expect([first.bills.length, second.bills.length, third.bills.length, first.total]).toEqual([4, 4, 1, 9]);
    expect(new Set([...first.bills, ...second.bills, ...third.bills].map((b: { billId: number }) => b.billId)).size).toBe(9);
  });
});

describe('settings on the printout', () => {
  it('uses the names, titles, phone numbers, paper size and due day from Settings', async () => {
    const admin = await loginAs('ADMIN');
    let header = (await admin.get('/api/water/print/summary')).body.header;
    expect(header).toMatchObject({
      phone: '(043) 740-0767',
      mobile: '0910-4918-512',
      cdaNo: '9520-04002341',
      paper: 'LETTER',
      signatories: [
        { label: 'Prepared by:', name: 'Alffa M. Mahiya', title: 'Billing Officer' },
        { name: 'Emard B. Ramos', title: 'Cashier' },
        { name: 'Marino R. Abanador', title: 'General Manager' },
      ],
    });
    await admin.put('/api/settings').send({
      water_due_rule: 'DAY_OF_NEXT_MONTH',
      water_due_day: '10',
      coop_mobile: '0917-000-1111',
      bill_preparer_name: 'Rosa B. Cruz',
      bill_manager_title: 'Manager',
      bill_paper: 'LONG',
    });
    header = (await admin.get('/api/water/print/summary')).body.header;
    expect(header).toMatchObject({ mobile: '0917-000-1111', dueNote: 'Due Date until 10th of the Month.', paper: 'LONG' });
    expect(header.signatories[0].name).toBe('Rosa B. Cruz');
    expect(header.signatories[2].title).toBe('Manager');
    for (const [day, text] of [['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['11', '11th'], ['21', '21st'], ['22', '22nd']]) {
      await admin.put('/api/settings').send({ water_due_day: day });
      expect((await admin.get('/api/water/print/summary')).body.header.dueNote).toBe(`Due Date until ${text} of the Month.`);
    }
    expect((await admin.put('/api/settings').send({ water_due_day: '31' })).status).toBe(400);
    expect((await (await loginAs('STAFF')).put('/api/settings').send({ bill_preparer_name: 'X' })).status).toBe(403);
  });
});

describe('due date rule', () => {
  it('is day 15 of the month after the billing month, moving on a month if the reading came too late', () => {
    expect(dueDateFor('2026-10', '2026-10-26', 'DAY_OF_NEXT_MONTH', 15, 15)).toBe('2026-11-15');
    expect(dueDateFor('2026-12', '2026-12-28', 'DAY_OF_NEXT_MONTH', 15, 15)).toBe('2027-01-15');
    expect(dueDateFor('2026-10', '2026-11-20', 'DAY_OF_NEXT_MONTH', 15, 15)).toBe('2026-12-15');
    expect(dueDateFor('2026-10', '2026-10-26', 'DAYS_AFTER_READING', 15, 15)).toBe('2026-11-10');
  });

  it('new bills follow the setting; bills already made keep their due date', async () => {
    const admin = await loginAs('ADMIN');
    const x = await customer('Juan Dela Cruz');
    await read(admin, x.connectionId, 1010, month(-1), `${month(-1)}-26`);
    const before = await prisma.waterBill.findFirstOrThrow();
    expect(before.dueDate.toISOString().slice(0, 10)).toBe(addDays(`${month(-1)}-26`, 15));

    await admin.put('/api/settings').send({ water_due_rule: 'DAY_OF_NEXT_MONTH', water_due_day: '15' });
    expect((await prisma.waterBill.findFirstOrThrow({ where: { id: before.id } })).dueDate).toEqual(before.dueDate);
    await read(admin, x.connectionId, 1020, THIS, today);
    const after = await prisma.waterBill.findFirstOrThrow({ where: { period: THIS } });
    expect(after.dueDate.toISOString().slice(0, 10)).toBe(dueDateFor(THIS, today, 'DAY_OF_NEXT_MONTH', 15, 15));
  });
});

describe('print record', () => {
  it('records who printed which bills, and allows reprinting', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const x = await customer('Juan Dela Cruz');
    await read(staff, x.connectionId, 1010);
    const bill = await prisma.waterBill.findFirstOrThrow();
    expect((await staff.get(`/api/water/bills/${bill.id}`)).body.lastPrinted).toBeNull();

    expect((await staff.post('/api/water/print/record').send({ billIds: [bill.id, 999999] })).body).toEqual({ recorded: 1 });
    expect((await cashier.post('/api/water/print/record').send({ billIds: [bill.id] })).body).toEqual({ recorded: 1 });
    expect(await prisma.billPrint.count({ where: { waterBillId: bill.id } })).toBe(2);
    const last = (await staff.get(`/api/water/bills/${bill.id}`)).body.lastPrinted;
    expect(last.by).toBe('CASHIER');
    expect((await staff.post('/api/water/print/record').send({ billIds: [] })).status).toBe(400);
    // One bill on its own, for the account's "Print bill" button.
    expect((await bills(staff, { billIds: String(bill.id) })).bills).toHaveLength(1);
  });
});
