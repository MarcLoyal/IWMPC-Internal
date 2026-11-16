import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila } from '../lib/dates';
import { loginAs, makeAccount, resetDb } from './helpers';

interface Units {
  dinoKilo: number;
  dinoSack: number;
  sinanKilo: number;
  lpg: number;
  dinoradoId: number;
}

let u: Units;

async function products(): Promise<Units> {
  const dinorado = await prisma.product.create({
    data: { name: 'Dinorado', category: 'RICE', sortOrder: 0, units: { create: [{ label: 'per kilo', price: 65, sortOrder: 0 }, { label: 'per sack (25 kg)', price: 1550, sortOrder: 1 }] } },
    include: { units: { orderBy: { id: 'asc' } } },
  });
  const sinandomeng = await prisma.product.create({
    data: { name: 'Sinandomeng', category: 'RICE', sortOrder: 1, units: { create: [{ label: 'per kilo', price: 52 }] } },
    include: { units: true },
  });
  const lpg = await prisma.product.create({
    data: { name: 'LPG', category: 'LPG', sortOrder: 2, units: { create: [{ label: 'per 11 kg tank (refill)', price: 950 }] } },
    include: { units: true },
  });
  return { dinoKilo: dinorado.units[0].id, dinoSack: dinorado.units[1].id, sinanKilo: sinandomeng.units[0].id, lpg: lpg.units[0].id, dinoradoId: dinorado.id };
}

beforeEach(async () => {
  await resetDb();
  u = await products();
});

const sale = (accountId: number | null, orNumber: string, items: { unitId: number; quantity: string | number }[], extra: Record<string, unknown> = {}) => ({
  accountId,
  orNumber,
  items,
  ...extra,
});

describe('prices are Admin only', () => {
  it('refuses every price change from Cashier, Staff and Board (on the server)', async () => {
    const newRates = { rateClass: 'RESIDENTIAL', effectiveFrom: '2099-01', minimumCharge: '1', minimumCoversM3: 5, note: 'x', tiers: [{ upTo: null, rate: '1' }] };
    for (const role of ['CASHIER', 'STAFF', 'BOARD'] as const) {
      const user = await loginAs(role);
      const attempts = [
        user.post(`/api/products/units/${u.lpg}/price`).send({ price: '1', reason: 'cheaper' }),
        user.post('/api/products').send({ name: 'Jasmine', category: 'RICE', label: 'per kilo', price: '70' }),
        user.put(`/api/products/${u.dinoradoId}`).send({ name: 'Dinorado', active: false }),
        user.post(`/api/products/${u.dinoradoId}/units`).send({ label: 'per sack (50 kg)', price: '3000' }),
        user.put(`/api/products/units/${u.lpg}`).send({ label: 'free', active: true }),
        user.post('/api/water/rates').send(newRates),
        user.put('/api/settings').send({ membership_fee: '1', installation_fee: '1', allow_credit: 'true' }),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
      // They can still see the prices.
      const list = await user.get('/api/products');
      expect(list.status).toBe(200);
      expect(list.body.products.map((p: { name: string }) => p.name)).toEqual(['Dinorado', 'Sinandomeng', 'LPG']);
      expect((await user.get(`/api/products/${u.dinoradoId}/history`)).status).toBe(200);
    }
    // Nothing changed.
    expect((await prisma.productUnit.findUniqueOrThrow({ where: { id: u.lpg } })).price.toFixed(2)).toBe('950.00');
    expect(await prisma.product.count()).toBe(3);
    expect(await prisma.priceChange.count()).toBe(0);
    expect(await prisma.rateSchedule.count()).toBe(2);
  });

  it('records every price change: old price, new price, who, when and why', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.post(`/api/products/units/${u.lpg}/price`).send({ price: '980' })).body.error).toBe('Please type a short reason for the price change.');
    expect((await admin.post(`/api/products/units/${u.lpg}/price`).send({ price: 'abc', reason: 'x' })).status).toBe(400);
    expect((await admin.post(`/api/products/units/${u.lpg}/price`).send({ price: '950', reason: 'same' })).status).toBe(400);

    const changed = await admin.post(`/api/products/units/${u.lpg}/price`).send({ price: '980', memberPrice: '960', reason: 'Supplier increase' });
    expect(changed.body).toMatchObject({ price: '980.00', memberPrice: '960.00' });
    await admin.post(`/api/products/units/${u.lpg}/price`).send({ price: '1,000.50', memberPrice: '', reason: 'Supplier increase again' });

    const lpg = await prisma.productUnit.findUniqueOrThrow({ where: { id: u.lpg } });
    const history = (await admin.get(`/api/products/${lpg.productId}/history`)).body.history;
    expect(history).toMatchObject([
      { oldPrice: '980.00', newPrice: '1000.50', oldMemberPrice: '960.00', newMemberPrice: null, reason: 'Supplier increase again', changedBy: 'ADMIN' },
      { oldPrice: '950.00', newPrice: '980.00', oldMemberPrice: null, newMemberPrice: '960.00', reason: 'Supplier increase', changedBy: 'ADMIN' },
    ]);
    expect(history[0].changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lets an Admin add a product and a unit without any code change', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/products').send({ name: 'Jasmine', label: 'per kilo', price: '70' })).body.error).toMatch(/kind/);
    const created = await admin.post('/api/products').send({ name: 'Jasmine', category: 'RICE', label: 'per kilo', price: '70' });
    expect(created.status).toBe(201);
    expect(created.body.category).toBe('RICE');
    expect((await admin.post('/api/products').send({ name: 'jasmine', category: 'RICE', label: 'per kilo', price: '70' })).status).toBe(409);
    expect((await admin.post(`/api/products/${created.body.id}/units`).send({ label: 'per sack (50 kg)', price: '3,300', memberPrice: '3250' })).status).toBe(201);
    expect((await admin.post(`/api/products/${created.body.id}/units`).send({ label: 'Per Kilo', price: '1' })).status).toBe(409);

    // Stop selling Sinandomeng: it leaves the Cashier's list but stays in Settings.
    const sinan = await prisma.productUnit.findUniqueOrThrow({ where: { id: u.sinanKilo } });
    await admin.put(`/api/products/${sinan.productId}`).send({ name: 'Sinandomeng', active: false });
    const names = async (query: object) => (await admin.get('/api/products').query(query)).body.products.map((p: { name: string }) => p.name);
    expect(await names({})).toEqual(['Dinorado', 'LPG', 'Jasmine']);
    expect(await names({ all: 1 })).toEqual(['Dinorado', 'Sinandomeng', 'LPG', 'Jasmine']);
    // New items start their price history.
    expect((await admin.get(`/api/products/${created.body.id}/history`)).body.history).toHaveLength(2);
  });
});

describe('selling at the Cashier', () => {
  it('saves several items under one OR number and works out the amounts', async () => {
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz');
    const res = await cashier.post('/api/sales').send(
      sale(juan.id, '5001', [
        { unitId: u.dinoSack, quantity: 1 },
        { unitId: u.lpg, quantity: 1 },
        { unitId: u.sinanKilo, quantity: '2.5' },
      ]),
    );
    expect(res.status).toBe(201);
    expect(res.body.total).toBe('2630.00'); // 1550 + 950 + 2.5 x 52
    expect(res.body.payment).toMatchObject({ type: 'RICE_LPG', amount: '2630.00', orNumber: '5001', accountName: 'Juan Dela Cruz', walkIn: false });
    expect(res.body.items).toMatchObject([
      { productName: 'Dinorado', unitLabel: 'per sack (25 kg)', quantity: '1', unitPrice: '1550.00', amount: '1550.00' },
      { productName: 'LPG', quantity: '1', amount: '950.00' },
      { productName: 'Sinandomeng', unitLabel: 'per kilo', quantity: '2.5', unitPrice: '52.00', amount: '130.00' },
    ]);
    expect(await prisma.payment.count()).toBe(1);

    const profile = await cashier.get(`/api/accounts/${juan.id}`);
    // On the Rice & LPG tab and in All Transactions.
    expect(profile.body.purchases).toHaveLength(3);
    expect(profile.body.purchases[0]).toMatchObject({ date: todayManila(), status: 'ACTIVE', orNumbers: ['5001'] });
    expect(profile.body.riceLpg).toMatchObject({ totalThisYear: '2630.00', riceThisYear: '1680.00', lpgThisYear: '950.00', creditBalance: '0.00' });
    expect(profile.body.purchases.map((p: { category: string }) => p.category)).toEqual(['RICE', 'LPG', 'RICE']);
    expect(profile.body.payments).toMatchObject([{ type: 'RICE_LPG', orNumber: '5001', amount: '2630.00' }]);
    expect(profile.body.payments[0].items).toHaveLength(3);

    const list = await cashier.get('/api/accounts');
    expect(list.body.rows[0].lastPurchase).toEqual({ date: todayManila(), item: 'Dinorado', moreItems: 2, amount: '2630.00' });
  });

  it('still blocks a duplicate OR number, across sales and other payments', async () => {
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz');
    const maria = await makeAccount('Maria Santos');
    await cashier.post('/api/sales').send(sale(juan.id, '5001', [{ unitId: u.lpg, quantity: 1 }]));
    await cashier.post('/api/payments').send({ accountId: maria.id, type: 'OTHER', amount: '50', orNumber: '5002', description: 'Certification' });

    const again = await cashier.post('/api/sales').send(sale(maria.id, '5001', [{ unitId: u.dinoKilo, quantity: 3 }]));
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('Juan Dela Cruz');
    expect((await cashier.post('/api/sales').send(sale(null, ' 5002 ', [{ unitId: u.lpg, quantity: 1 }]))).status).toBe(409);
    // A walk-in's OR number is protected the same way, and the message names the walk-in.
    await cashier.post('/api/sales').send(sale(null, '5003', [{ unitId: u.lpg, quantity: 1 }], { walkInName: 'Aling Nena' }));
    const other = await cashier.post('/api/payments').send({ accountId: juan.id, type: 'OTHER', amount: '1', orNumber: '5003', description: 'x' });
    expect(other.status).toBe(409);
    expect(other.body.error).toContain('Aling Nena');

    expect(await prisma.sale.count()).toBe(2);
    expect(await prisma.saleItem.count()).toBe(2);
    expect(await prisma.payment.count()).toBe(3);
  });

  it('counts a walk-in sale in the daily totals but puts it on no account', async () => {
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz');
    const res = await cashier.post('/api/sales').send(sale(null, '5001', [{ unitId: u.dinoKilo, quantity: 4 }, { unitId: u.lpg, quantity: 2 }]));
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ accountId: null, accountName: 'Walk-in customer', walkIn: true, amount: '2160.00' });

    const report = await cashier.get('/api/reports/daily');
    expect(report.body.grandTotal).toBe('2160.00');
    expect(report.body.totals).toEqual([{ type: 'RICE_LPG', count: 1, total: '2160.00' }]);
    expect(report.body.payments[0]).toMatchObject({ accountName: 'Walk-in customer', orNumber: '5001' });
    expect(report.body.riceLpg.lines).toEqual([
      { product: 'Dinorado', unit: 'per kilo', quantity: '4', amount: '260.00' },
      { product: 'LPG', unit: 'per 11 kg tank (refill)', quantity: '2', amount: '1900.00' },
    ]);
    expect((await cashier.get('/api/reports/home')).body.collections).toEqual({ total: '2160.00', count: 1 });

    // Not on any account.
    expect(await prisma.sale.count({ where: { accountId: { not: null } } })).toBe(0);
    expect(await prisma.payment.count({ where: { accountId: { not: null } } })).toBe(0);
    const profile = await cashier.get(`/api/accounts/${juan.id}`);
    expect(profile.body.purchases).toEqual([]);
    expect(profile.body.payments).toEqual([]);
    expect((await cashier.get('/api/accounts')).body.rows[0].lastPurchase).toBeNull();
    // Still findable by its OR number.
    expect((await cashier.get('/api/payments').query({ or: '5001' })).body.payment.walkIn).toBe(true);
  });

  it('uses the member price for members only, when one is set', async () => {
    const admin = await loginAs('ADMIN');
    await admin.post(`/api/products/units/${u.lpg}/price`).send({ price: '950', memberPrice: '900', reason: 'Member discount' });
    const member = await makeAccount('Member Person');
    await prisma.account.update({ where: { id: member.id }, data: { isMember: true, membershipStatus: 'MEMBER' } });
    const nonMember = await makeAccount('Non Member');

    const items = [{ unitId: u.lpg, quantity: 1 }, { unitId: u.dinoKilo, quantity: 1 }];
    // Dinorado has no member price, so it is 65 for everyone.
    expect((await admin.post('/api/sales').send(sale(member.id, '1', items))).body.total).toBe('965.00');
    expect((await admin.post('/api/sales').send(sale(nonMember.id, '2', items))).body.total).toBe('1015.00');
    expect((await admin.post('/api/sales').send(sale(null, '3', items))).body.total).toBe('1015.00');
  });

  it('refuses a sale with no OR number, no items, a bad quantity, or an unpriced or retired item', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz');
    const one = [{ unitId: u.lpg, quantity: 1 }];
    expect((await admin.post('/api/sales').send(sale(juan.id, '', one))).body.error).toMatch(/OR number/);
    expect((await admin.post('/api/sales').send(sale(juan.id, '   ', one))).status).toBe(400);
    expect((await admin.post('/api/sales').send(sale(juan.id, '1', []))).status).toBe(400);
    for (const quantity of [0, -1, 'abc', '1.234']) {
      expect((await admin.post('/api/sales').send(sale(juan.id, '1', [{ unitId: u.lpg, quantity }]))).status).toBe(400);
    }
    await prisma.productUnit.update({ where: { id: u.sinanKilo }, data: { price: 0 } });
    const unpriced = await admin.post('/api/sales').send(sale(juan.id, '1', [{ unitId: u.sinanKilo, quantity: 1 }]));
    expect(unpriced.body.error).toMatch(/price of Sinandomeng .* has not been set/);
    await admin.put(`/api/products/units/${u.lpg}`).send({ label: 'per 11 kg tank (refill)', active: false });
    expect((await admin.post('/api/sales').send(sale(juan.id, '1', one))).body.error).toMatch(/no longer sold/);
    // A plain "Rice & LPG" payment with no items is not a sale.
    expect((await admin.post('/api/payments').send({ accountId: juan.id, type: 'RICE_LPG', amount: '100', orNumber: '1' })).status).toBe(400);
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('is for the Cashier and Admin only', async () => {
    const juan = await makeAccount('Juan Dela Cruz');
    for (const role of ['STAFF', 'BOARD'] as const) {
      const res = await (await loginAs(role)).post('/api/sales').send(sale(juan.id, '1', [{ unitId: u.lpg, quantity: 1 }]));
      expect(res.status).toBe(403);
    }
    expect(await prisma.sale.count()).toBe(0);
  });
});

describe('prices and past sales', () => {
  it('a later price change, rename or retirement does not change a sale already made', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz');
    await admin.post('/api/sales').send(sale(juan.id, '5001', [{ unitId: u.dinoSack, quantity: 2 }]));

    await admin.post(`/api/products/units/${u.dinoSack}/price`).send({ price: '1700', reason: 'Harvest season' });
    await admin.put(`/api/products/units/${u.dinoSack}`).send({ label: 'per sack (25 kilos)', active: true });
    await admin.put(`/api/products/${u.dinoradoId}`).send({ name: 'Dinorado Special', active: true });

    const profile = await admin.get(`/api/accounts/${juan.id}`);
    expect(profile.body.purchases).toMatchObject([
      { productName: 'Dinorado', unitLabel: 'per sack (25 kg)', quantity: '2', unitPrice: '1550.00', amount: '3100.00' },
    ]);
    expect(profile.body.payments[0].amount).toBe('3100.00');
    expect(profile.body.riceLpg.totalThisYear).toBe('3100.00');
    expect((await admin.get('/api/reports/daily')).body.grandTotal).toBe('3100.00');

    // A new sale uses the new price; the report keeps both.
    await admin.post('/api/sales').send(sale(juan.id, '5002', [{ unitId: u.dinoSack, quantity: 1 }]));
    const report = await admin.get('/api/sales/report');
    expect(report.body.summary).toEqual([
      { product: 'Dinorado', unit: 'per sack (25 kg)', quantity: '2', amount: '3100.00', sales: 1 },
      { product: 'Dinorado Special', unit: 'per sack (25 kilos)', quantity: '1', amount: '1700.00', sales: 1 },
    ]);
    expect(report.body.total).toBe('4800.00');
  });

  it('voiding the payment voids the whole sale: it stays visible but leaves the totals', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz');
    const sold = await admin.post('/api/sales').send(sale(juan.id, '5001', [{ unitId: u.dinoSack, quantity: 1 }, { unitId: u.lpg, quantity: 1 }]));
    await admin.post('/api/sales').send(sale(juan.id, '5002', [{ unitId: u.lpg, quantity: 1 }]));
    await admin.post(`/api/payments/${sold.body.payment.id}/void`).send({ reason: 'Customer returned the goods' });

    const profile = await admin.get(`/api/accounts/${juan.id}`);
    expect(profile.body.purchases.map((p: { status: string }) => p.status)).toEqual(['ACTIVE', 'VOID', 'VOID']);
    expect(profile.body.riceLpg.totalThisYear).toBe('950.00');
    const report = await admin.get('/api/sales/report');
    expect(report.body.total).toBe('950.00');
    expect(report.body.saleCount).toBe(1);
    const daily = await admin.get('/api/reports/daily');
    expect(daily.body.grandTotal).toBe('950.00');
    expect(daily.body.riceLpg.lines).toEqual([{ product: 'LPG', unit: 'per 11 kg tank (refill)', quantity: '1', amount: '950.00' }]);
    // The voided OR number stays used.
    expect((await admin.post('/api/sales').send(sale(juan.id, '5001', [{ unitId: u.lpg, quantity: 1 }]))).status).toBe(409);
  });
});

describe('Rice & LPG Sales report', () => {
  it('totals by product for a date range and can show one product', async () => {
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz');
    await cashier.post('/api/sales').send(sale(juan.id, '1', [{ unitId: u.dinoKilo, quantity: 5 }, { unitId: u.lpg, quantity: 1 }]));
    await cashier.post('/api/sales').send(sale(null, '2', [{ unitId: u.dinoKilo, quantity: '2.5' }], { walkInName: 'Aling Nena' }));
    // An older sale, outside this month's range.
    const old = await cashier.post('/api/sales').send(sale(juan.id, '3', [{ unitId: u.lpg, quantity: 3 }]));
    await prisma.sale.update({ where: { id: old.body.saleId }, data: { saleDate: new Date('2020-01-15T00:00:00Z') } });

    const board = await loginAs('BOARD');
    const report = await board.get('/api/sales/report');
    expect(report.body.summary).toEqual([
      { product: 'Dinorado', unit: 'per kilo', quantity: '7.5', amount: '487.50', sales: 2 },
      { product: 'LPG', unit: 'per 11 kg tank (refill)', quantity: '1', amount: '950.00', sales: 1 },
    ]);
    expect(report.body).toMatchObject({ total: '1437.50', saleCount: 2, creditTotal: '0.00' });
    expect(report.body.lines.map((l: { buyer: string }) => l.buyer)).toEqual(['Juan Dela Cruz', 'Juan Dela Cruz', 'Aling Nena']);

    expect(report.body.totalsByKind).toEqual({ RICE: '487.50', LPG: '950.00' });
    // "All rice" and "LPG" filters.
    const rice = await board.get('/api/sales/report').query({ category: 'RICE' });
    expect(rice.body.total).toBe('487.50');
    expect(rice.body.lines.every((l: { category: string }) => l.category === 'RICE')).toBe(true);
    const lpgOnly = await board.get('/api/sales/report').query({ category: 'LPG' });
    expect(lpgOnly.body.summary).toEqual([{ product: 'LPG', unit: 'per 11 kg tank (refill)', quantity: '1', amount: '950.00', sales: 1 }]);

    const onlyDinorado = await board.get('/api/sales/report').query({ productId: u.dinoradoId });
    expect(onlyDinorado.body.total).toBe('487.50');
    const year2020 = await board.get('/api/sales/report').query({ from: '2020-01-01', to: '2020-12-31' });
    expect(year2020.body.summary).toEqual([{ product: 'LPG', unit: 'per 11 kg tank (refill)', quantity: '3', amount: '2850.00', sales: 1 }]);
    expect((await board.get('/api/sales/report').query({ from: '2026-02-01', to: '2026-01-01' })).status).toBe(400);
  });
});

describe('credit (utang)', () => {
  const credit = (accountId: number | null) => sale(accountId, '', [{ unitId: u.dinoSack, quantity: 1 }], { credit: true });

  it('is off by default: a credit sale is refused', async () => {
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz');
    expect((await cashier.get('/api/settings')).body.allow_credit).toBe('false');
    const res = await cashier.post('/api/sales').send(credit(juan.id));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Credit sales are turned off/);
    expect(await prisma.sale.count()).toBe(0);
  });

  it('when turned on: the sale has no OR number, shows in What they owe, and is paid later with an OR number', async () => {
    const admin = await loginAs('ADMIN');
    const cashier = await loginAs('CASHIER');
    expect((await admin.put('/api/settings').send({ allow_credit: 'true' })).status).toBe(200);
    const juan = await makeAccount('Juan Dela Cruz');

    // A walk-in cannot buy on credit.
    expect((await cashier.post('/api/sales').send(credit(null))).status).toBe(400);

    const sold = await cashier.post('/api/sales').send(credit(juan.id));
    expect(sold.status).toBe(201);
    expect(sold.body).toMatchObject({ isCredit: true, total: '1550.00', payment: null });
    expect(await prisma.payment.count()).toBe(0);
    // Nothing collected yet.
    expect((await cashier.get('/api/reports/daily')).body.grandTotal).toBe('0.00');

    let profile = await cashier.get(`/api/accounts/${juan.id}`);
    expect(profile.body.owed).toMatchObject([{ type: 'RICE_LPG', amount: '1550.00', saleId: sold.body.saleId }]);
    expect(profile.body.riceLpg).toMatchObject({ totalThisYear: '1550.00', creditBalance: '1550.00' });
    expect(profile.body.purchases[0]).toMatchObject({ isCredit: true, balance: '1550.00', orNumbers: [] });

    const pay = (amount: string, orNumber: string) =>
      cashier.post('/api/payments').send({ accountId: juan.id, type: 'RICE_LPG', amount, orNumber, saleId: sold.body.saleId });
    expect((await pay('2000', '7001')).body.error).toMatch(/more than what is owed/);
    expect((await pay('1000', '7001')).status).toBe(201);
    profile = await cashier.get(`/api/accounts/${juan.id}`);
    expect(profile.body.owed).toMatchObject([{ amount: '550.00' }]);
    expect((await pay('550', '7002')).status).toBe(201);
    profile = await cashier.get(`/api/accounts/${juan.id}`);
    expect(profile.body.owed).toEqual([]);
    expect(profile.body.purchases[0]).toMatchObject({ balance: '0.00', orNumbers: ['7001', '7002'] });

    // Collected today, shown apart from goods sold for cash.
    const daily = await cashier.get('/api/reports/daily');
    expect(daily.body.grandTotal).toBe('1550.00');
    expect(daily.body.riceLpg).toEqual({ lines: [], creditCollected: '1550.00' });

    // Voiding a payment puts the balance back.
    const first = await prisma.payment.findUniqueOrThrow({ where: { orNumber: '7001' } });
    await admin.post(`/api/payments/${first.id}/void`).send({ reason: 'Wrong receipt' });
    profile = await admin.get(`/api/accounts/${juan.id}`);
    expect(profile.body.owed).toMatchObject([{ amount: '1000.00' }]);
    expect(profile.body.purchases[0].status).toBe('ACTIVE');
  });
});
