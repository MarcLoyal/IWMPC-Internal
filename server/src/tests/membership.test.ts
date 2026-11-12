import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { loginAs, makeAccount, membershipForm, resetDb } from './helpers';

// Names don't matter in most of these tests; one filled-in form is reused.
const FORM = membershipForm('Juan Dela Cruz');

beforeEach(resetDb);

const fee = (accountId: number, orNumber: string, amount = '500.00') => ({
  accountId,
  type: 'MEMBERSHIP_FEE',
  amount,
  orNumber,
});

describe('Make a Member', () => {
  it('is blocked on the server without an active connection', async () => {
    const staff = await loginAs('STAFF');
    const none = await makeAccount('No Connection');
    const pending = await makeAccount('Pending Install', 'PENDING_INSTALLATION');
    const cut = await makeAccount('Disconnected', 'DISCONNECTED');

    for (const account of [none, pending, cut]) {
      const res = await staff.post(`/api/accounts/${account.id}/make-member`).send(FORM);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no active water connection/);
      const profile = await staff.get(`/api/accounts/${account.id}`);
      expect(profile.body.canMakeMember).toBe(false);
    }
    expect(await prisma.account.count({ where: { membershipStatus: { not: 'NONE' } } })).toBe(0);
  });

  it('makes the account a member only once the membership fee is paid', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');

    const start = await staff
      .post(`/api/accounts/${juan.id}/make-member`)
      .send({ ...FORM, beneficiaries: [{ name: 'Maria Dela Cruz', relationship: 'Spouse' }] });
    expect(start.status).toBe(200);

    let profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ isMember: false, membershipStatus: 'PENDING', memberNumber: null });
    expect(profile.body.owed).toMatchObject([{ type: 'MEMBERSHIP_FEE', amount: '500.00' }]);

    expect((await cashier.post('/api/payments').send(fee(juan.id, '1045'))).status).toBe(201);

    profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ isMember: true, membershipStatus: 'MEMBER', memberNumber: '0001' });
    expect(profile.body.account.memberSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(profile.body.account.beneficiaries).toMatchObject([{ name: 'Maria Dela Cruz', relationship: 'Spouse' }]);
    expect(profile.body.owed).toEqual([]);
  });

  it('refuses the membership fee if Make a Member was not clicked first', async () => {
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    const res = await cashier.post('/api/payments').send(fee(juan.id, '1045'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Make a Member/);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('re-checks the active connection when the fee is paid', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    // Disconnected between applying and paying.
    await prisma.waterConnection.updateMany({ where: { accountId: juan.id }, data: { status: 'DISCONNECTED' } });

    const res = await cashier.post('/api/payments').send(fee(juan.id, '1045'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active water connection/);
    expect(await prisma.payment.count()).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).isMember).toBe(false);
  });

  it('requires the membership fee in full', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    for (const amount of ['250', '499.99', '600']) {
      const res = await cashier.post('/api/payments').send(fee(juan.id, '1045', amount));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/in full/);
    }
    expect(await prisma.payment.count()).toBe(0);
  });

  it('cannot be done twice, and is_member cannot be set by editing the account', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await cashier.post('/api/payments').send(fee(juan.id, '1045'));

    expect((await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM)).status).toBe(400);
    expect((await cashier.post('/api/payments').send(fee(juan.id, '1046'))).status).toBe(400);

    const maria = await makeAccount('Maria Santos');
    const edit = await staff
      .put(`/api/accounts/${maria.id}`)
      .send({ firstName: 'Maria', lastName: 'Santos', areaId: 1, isMember: true, membershipStatus: 'MEMBER', memberNumber: '9999', boardDecision: 'APPROVED' });
    expect(edit.status).toBe(200);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: maria.id } })).toMatchObject({
      isMember: false,
      membershipStatus: 'NONE',
      memberNumber: null,
      boardDecision: null,
    });
  });

  it('gives member numbers in sequence, following the format in Settings, and skips numbers already used', async () => {
    const admin = await loginAs('ADMIN');
    await admin.put('/api/settings').send({ member_no_prefix: 'M-', member_no_padding: 4, member_no_next: 123 });
    // An existing member encoded at setup already holds M-0124.
    const existing = await makeAccount('Existing Member', 'ACTIVE');
    await prisma.account.update({
      where: { id: existing.id },
      data: { isMember: true, membershipStatus: 'MEMBER', memberNumber: 'M-0124' },
    });

    const numbers: (string | null)[] = [];
    for (const [i, name] of ['Ana', 'Ben', 'Carla'].entries()) {
      const account = await makeAccount(name, 'ACTIVE');
      await admin.post(`/api/accounts/${account.id}/make-member`).send(FORM);
      await admin.post('/api/payments').send(fee(account.id, String(2000 + i)));
      numbers.push((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).memberNumber);
    }
    expect(numbers).toEqual(['M-0123', 'M-0125', 'M-0126']);
  });

  it('voiding the membership fee returns the account to Non-member but keeps the number reserved', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    const payment = await admin.post('/api/payments').send(fee(juan.id, '1045'));
    await admin.post(`/api/payments/${payment.body.id}/void`).send({ reason: 'Receipt cancelled' });

    const profile = await admin.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ isMember: false, membershipStatus: 'NONE', memberNumber: null });
    // The number is still held on the record, so nobody else can get it.
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).memberNumber).toBe('0001');

    const maria = await makeAccount('Maria Santos', 'ACTIVE');
    await admin.post(`/api/accounts/${maria.id}/make-member`).send(FORM);
    await admin.post('/api/payments').send(fee(maria.id, '1046'));
    expect((await prisma.account.findUniqueOrThrow({ where: { id: maria.id } })).memberNumber).toBe('0002');

    // If Juan joins again he gets his old number back.
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await admin.post('/api/payments').send(fee(juan.id, '1047'));
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).memberNumber).toBe('0001');
  });

  it('warns, and changes nothing, when a member is disconnected (R8)', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await admin.post('/api/payments').send(fee(juan.id, '1045'));
    const connection = await prisma.waterConnection.findFirstOrThrow({ where: { accountId: juan.id } });

    expect((await admin.patch(`/api/connections/${connection.id}`).send({ status: 'DISCONNECTED' })).status).toBe(200);
    const profile = await admin.get(`/api/accounts/${juan.id}`);
    expect(profile.body.warnings).toEqual(['This member has no active water connection.']);
    expect(profile.body.account.isMember).toBe(true);
  });

  it('saves everything on the Application for Membership form', async () => {
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Cruz', 'ACTIVE');
    const res = await staff.post(`/api/accounts/${juan.id}/make-member`).send({
      lastName: 'Dela Cruz',
      firstName: 'Juan',
      middleName: 'Santos',
      areaId: 2,
      purok: 'Purok 3',
      barangay: 'Inicbulan',
      municipality: 'Bauan',
      province: 'Batangas',
      phone: '0917 555 0101',
      birthDate: '1958-03-14',
      sex: 'MALE',
      civilStatus: 'MARRIED',
      tin: '123-456-789',
      religion: 'Roman Catholic',
      education: 'High School Graduate',
      membershipAppliedOn: '2026-11-10',
      membershipPurpose: 'To avail of services',
      sharesSubscribed: '10',
      sharesAmount: '1,000',
      meterRegisteredName: 'Maria Dela Cruz',
      pmesAttended: true,
      boardDecision: 'APPROVED',
      boardDecisionDate: '2026-11-11',
      beneficiaries: [
        { name: 'Maria Dela Cruz', relationship: 'Spouse' },
        { name: 'Jose Dela Cruz', relationship: 'Son' },
      ],
    });
    expect(res.status).toBe(200);

    const { account } = (await staff.get(`/api/accounts/${juan.id}`)).body;
    expect(account).toMatchObject({
      fullName: 'Juan Santos Dela Cruz',
      lastName: 'Dela Cruz',
      address: 'Purok 3, Inicbulan, Bauan, Batangas',
      area: 'Ipil',
      sex: 'MALE',
      tin: '123-456-789',
      religion: 'Roman Catholic',
      education: 'High School Graduate',
      membershipStatus: 'PENDING',
      membershipAppliedOn: '2026-11-10',
      membershipPurpose: 'To avail of services',
      sharesSubscribed: 10,
      sharesAmount: '1000.00',
      meterRegisteredName: 'Maria Dela Cruz',
      pmesAttended: true,
      boardDecision: 'APPROVED',
      boardDecisionDate: '2026-11-11',
    });
    expect(account.beneficiaries).toHaveLength(2);
  });

  it('asks for the birthday, sex and civil status, and uses today when no application date is given', async () => {
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    const url = `/api/accounts/${juan.id}/make-member`;
    expect((await staff.post(url).send({ ...FORM, birthDate: '' })).body.error).toBe('Please enter the birthday.');
    expect((await staff.post(url).send({ ...FORM, sex: null })).body.error).toBe('Please choose the sex.');
    expect((await staff.post(url).send({ ...FORM, civilStatus: null })).body.error).toBe('Please choose the civil status.');
    expect((await staff.post(url).send({ ...FORM, sharesSubscribed: '2.5' })).status).toBe(400);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).membershipStatus).toBe('NONE');

    expect((await staff.post(url).send(FORM)).status).toBe(200);
    const { account } = (await staff.get(`/api/accounts/${juan.id}`)).body;
    expect(account.membershipAppliedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(account.pmesAttended).toBeNull();
  });

  it('records share capital with its own OR number, for members and applicants only', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    const capital = (orNumber: string) => ({ accountId: juan.id, type: 'SHARE_CAPITAL', amount: '1000', orNumber });

    const tooEarly = await admin.post('/api/payments').send(capital('2001'));
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error).toMatch(/Only members can pay share capital/);

    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    expect((await admin.post('/api/payments').send(capital('2001'))).status).toBe(201);
    // Paying share capital alone does not make someone a member.
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).isMember).toBe(false);

    await admin.post('/api/payments').send(fee(juan.id, '2002'));
    const report = await admin.get('/api/reports/daily');
    expect(report.body.totals).toEqual([
      { type: 'MEMBERSHIP_FEE', count: 1, total: '500.00' },
      { type: 'SHARE_CAPITAL', count: 1, total: '1000.00' },
    ]);
  });
});
