import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila } from '../lib/dates';
import { loginAs, makeAccount, membershipForm, resetDb } from './helpers';

// Names don't matter in most of these tests; one filled-in form is reused.
const FORM = membershipForm('Juan Dela Cruz');

beforeEach(resetDb);

/** The Admin records the Board's approval of the waiting application. */
async function approve(accountId: number, boardDecisionDate = todayManila()) {
  const res = await (await loginAs('ADMIN')).post(`/api/accounts/${accountId}/membership-decision`).send({ decision: 'APPROVED', boardDecisionDate, reference: 'Res. No. 12' });
  expect(res.status).toBe(200);
}

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
    expect(profile.body.account).toMatchObject({ isMember: false, membershipStatus: 'FOR_APPROVAL', memberNumber: null });
    expect(profile.body.owed).toEqual([]);

    await approve(juan.id);
    profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ isMember: false, membershipStatus: 'PENDING', boardDecision: 'APPROVED', memberNumber: null });
    expect(profile.body.owed).toMatchObject([{ type: 'MEMBERSHIP_FEE', amount: '500.00' }]);

    expect((await cashier.post('/api/payments').send(fee(juan.id, '1045'))).status).toBe(201);

    profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ isMember: true, membershipStatus: 'MEMBER', memberNumber: '0001' });
    expect(profile.body.account.memberSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(profile.body.account.beneficiaries).toMatchObject([{ name: 'Maria Dela Cruz', relationship: 'Spouse' }]);
    expect(profile.body.owed).toEqual([]);
  });

  it('refuses the membership fee without an application, and while it waits for approval', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    const none = await cashier.post('/api/payments').send(fee(juan.id, '1045'));
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/no approved membership application/);

    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    const waiting = await cashier.post('/api/payments').send(fee(juan.id, '1045'));
    expect(waiting.status).toBe(400);
    expect(waiting.body.error).toMatch(/waiting for the Admin's approval/);
    // Not through the invoice screen either.
    const invoice = await cashier.post('/api/invoices').send({ accountId: juan.id, walkInName: '', number: '1045', items: [{ type: 'MEMBERSHIP_FEE', amount: '500' }] });
    expect(invoice.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('re-checks the active connection when the fee is paid', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await approve(juan.id);
    // Disconnected between applying and paying.
    await prisma.waterConnection.updateMany({ where: { accountId: juan.id }, data: { status: 'DISCONNECTED' } });

    const res = await cashier.post('/api/payments').send(fee(juan.id, '1045'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active water connection/);
    expect(await prisma.payment.count()).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).isMember).toBe(false);
  });

  it('requires at least the full membership fee, and allows paying more', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await approve(juan.id);
    for (const amount of ['250', '499.99']) {
      const res = await cashier.post('/api/payments').send(fee(juan.id, '1045', amount));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/in full/);
    }
    expect(await prisma.payment.count()).toBe(0);
    const more = await cashier.post('/api/payments').send(fee(juan.id, '1045', '600'));
    expect(more.status).toBe(201);
    expect(more.body.amount).toBe('600.00');
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).isMember).toBe(true);
  });

  it('cannot be done twice, and is_member cannot be set by editing the account', async () => {
    const staff = await loginAs('STAFF');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await approve(juan.id);
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
      await approve(account.id);
      await admin.post('/api/payments').send(fee(account.id, String(2000 + i)));
      numbers.push((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).memberNumber);
    }
    expect(numbers).toEqual(['M-0123', 'M-0125', 'M-0126']);
  });

  it('voiding the membership fee goes back to Approved – waiting for fee, and keeps the number reserved', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await approve(juan.id);
    const payment = await admin.post('/api/payments').send(fee(juan.id, '1045'));
    await admin.post(`/api/payments/${payment.body.id}/void`).send({ reason: 'Receipt cancelled' });

    const profile = await admin.get(`/api/accounts/${juan.id}`);
    // The Board's approval still stands: the fee can simply be received again.
    expect(profile.body.account).toMatchObject({ isMember: false, membershipStatus: 'PENDING', memberNumber: null });
    expect(profile.body.owed).toMatchObject([{ type: 'MEMBERSHIP_FEE' }]);
    // The number is still held on the record, so nobody else can get it.
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).memberNumber).toBe('0001');

    const maria = await makeAccount('Maria Santos', 'ACTIVE');
    await admin.post(`/api/accounts/${maria.id}/make-member`).send(FORM);
    await approve(maria.id);
    await admin.post('/api/payments').send(fee(maria.id, '1046'));
    expect((await prisma.account.findUniqueOrThrow({ where: { id: maria.id } })).memberNumber).toBe('0002');

    // When Juan pays again (no new application needed) he gets his old number back.
    expect((await admin.post('/api/payments').send(fee(juan.id, '1047'))).status).toBe(201);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).memberNumber).toBe('0001');
  });

  it('warns, and changes nothing, when a member is disconnected (R8)', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    await approve(juan.id);
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
      membershipStatus: 'FOR_APPROVAL',
      membershipAppliedOn: '2026-11-10',
      membershipPurpose: 'To avail of services',
      sharesSubscribed: 10,
      sharesAmount: '1000.00',
      meterRegisteredName: 'Maria Dela Cruz',
      pmesAttended: true,
      // Sent by Staff, but only the Admin can record the Board's decision.
      boardDecision: null,
      boardDecisionDate: null,
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

  it('records share capital for members and approved applicants only, not while waiting for approval', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    const capital = (orNumber: string) => ({ accountId: juan.id, type: 'SHARE_CAPITAL', amount: '1000', orNumber });

    const tooEarly = await admin.post('/api/payments').send(capital('2001'));
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error).toMatch(/Only members, and applicants approved by the Admin/);

    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    expect((await admin.post('/api/payments').send(capital('2001'))).status).toBe(400);
    await approve(juan.id);
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

describe('Membership approval (Board decision recorded by the Admin)', () => {
  const decide = (agent: Awaited<ReturnType<typeof loginAs>>, id: number, body: Record<string, unknown>) =>
    agent.post(`/api/accounts/${id}/membership-decision`).send(body);

  it('is for the Admin only, checked on the server', async () => {
    const staff = await loginAs('STAFF');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    const approved = { decision: 'APPROVED', boardDecisionDate: todayManila() };
    for (const role of ['STAFF', 'CASHIER', 'BOARD', 'LOAN_OFFICER'] as const) {
      expect((await decide(await loginAs(role), juan.id, approved)).status).toBe(403);
    }
    // Even a Staff member given extra work cannot approve: approval is not something that can be given.
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).membershipStatus).toBe('FOR_APPROVAL');
    expect((await decide(await loginAs('ADMIN'), juan.id, approved)).status).toBe(200);
  });

  it('needs the date of the Board decision (not in the future), and a reason when not approved', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    expect((await decide(admin, juan.id, { decision: 'APPROVED' })).body.error).toMatch(/date of the Board decision/);
    expect((await decide(admin, juan.id, { decision: 'APPROVED', boardDecisionDate: '2999-01-01' })).body.error).toMatch(/future/);
    expect((await decide(admin, juan.id, { decision: 'DISAPPROVED', boardDecisionDate: todayManila(), reason: ' ' })).body.error).toMatch(/reason/);
    expect((await decide(admin, juan.id, { decision: 'MAYBE', boardDecisionDate: todayManila() })).status).toBe(400);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: juan.id } })).membershipStatus).toBe('FOR_APPROVAL');
  });

  it('cannot decide when nothing is waiting, or decide twice', async () => {
    const admin = await loginAs('ADMIN');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    const body = { decision: 'APPROVED', boardDecisionDate: todayManila() };
    expect((await decide(admin, juan.id, body)).body.error).toMatch(/no membership application waiting/);
    await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    expect((await decide(admin, juan.id, body)).status).toBe(200);
    expect((await decide(admin, juan.id, body)).status).toBe(400);
    // And Staff cannot submit again while it is approved and waiting for the fee.
    const again = await admin.post(`/api/accounts/${juan.id}/make-member`).send(FORM);
    expect(again.body.error).toMatch(/already approved/);
  });

  it('not approved: no fee can be received; they can apply again later and the old decision stays in the history', async () => {
    const staff = await loginAs('STAFF');
    const admin = await loginAs('ADMIN');
    const cashier = await loginAs('CASHIER');
    const juan = await makeAccount('Juan Dela Cruz', 'ACTIVE');
    await staff.post(`/api/accounts/${juan.id}/make-member`).send({ ...FORM, membershipAppliedOn: '2026-01-05' });
    const no = await decide(admin, juan.id, { decision: 'DISAPPROVED', boardDecisionDate: '2026-02-01', reference: 'Res. No. 3', reason: 'Incomplete requirements' });
    expect(no.status).toBe(200);

    let profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ membershipStatus: 'NOT_APPROVED', boardDecision: 'DISAPPROVED', boardDecisionDate: '2026-02-01', isMember: false });
    expect(profile.body.canMakeMember).toBe(true);
    const paid = await cashier.post('/api/payments').send(fee(juan.id, '1045'));
    expect(paid.body.error).toMatch(/not approved by the Board/);

    // Applying again.
    expect((await staff.post(`/api/accounts/${juan.id}/make-member`).send({ ...FORM, membershipAppliedOn: '2026-03-01' })).status).toBe(200);
    profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ membershipStatus: 'FOR_APPROVAL', boardDecision: null });
    await approve(juan.id);
    expect((await cashier.post('/api/payments').send(fee(juan.id, '1045'))).status).toBe(201);

    profile = await staff.get(`/api/accounts/${juan.id}`);
    expect(profile.body.account).toMatchObject({ isMember: true, membershipStatus: 'MEMBER' });
    expect(profile.body.membershipApplications).toMatchObject([
      { appliedOn: '2026-03-01', decision: 'APPROVED', reference: 'Res. No. 12', decidedBy: expect.any(String) },
      { appliedOn: '2026-01-05', decision: 'DISAPPROVED', boardDecisionDate: '2026-02-01', reference: 'Res. No. 3', reason: 'Incomplete requirements', submittedBy: expect.any(String) },
    ]);
    // Every step is in the Audit Log.
    const actions = (await prisma.auditLog.findMany({ where: { entityId: String(juan.id), action: { startsWith: 'membership.' } }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['membership.start', 'membership.not-approved', 'membership.start', 'membership.approve', 'membership.complete']);
  });

  it('lists applications by status for everyone, and counts the waiting ones on Home', async () => {
    const staff = await loginAs('STAFF');
    const board = await loginAs('BOARD');
    const [ana, ben, carla] = [await makeAccount('Ana Cruz', 'ACTIVE'), await makeAccount('Ben Reyes', 'ACTIVE'), await makeAccount('Carla Santos', 'ACTIVE')];
    for (const a of [ana, ben, carla]) await staff.post(`/api/accounts/${a.id}/make-member`).send(FORM);
    await approve(ben.id);
    await decide(await loginAs('ADMIN'), carla.id, { decision: 'DISAPPROVED', boardDecisionDate: todayManila(), reason: 'No PMES' });

    const waiting = await board.get('/api/accounts/membership-applications');
    expect(waiting.status).toBe(200);
    expect(waiting.body.counts).toEqual({ FOR_APPROVAL: 1, APPROVED: 1, NOT_APPROVED: 1 });
    expect(waiting.body.rows).toMatchObject([{ id: ana.id, application: { decision: null } }]);
    expect((await board.get('/api/accounts/membership-applications?status=APPROVED')).body.rows).toMatchObject([{ id: ben.id }]);
    expect((await board.get('/api/accounts/membership-applications?status=NOT_APPROVED')).body.rows).toMatchObject([{ id: carla.id, application: { reason: 'No PMES' } }]);
    expect((await board.get('/api/reports/home')).body.membershipForApproval).toBe(1);
  });
});

describe('Apply for Membership on the Accounts list', () => {
  it('is offered only to non-members with an active connection and no application in progress', async () => {
    const staff = await loginAs('STAFF');
    const ready = await makeAccount('Ana Ready', 'ACTIVE');
    await makeAccount('Ben Pending', 'PENDING_INSTALLATION');
    await makeAccount('Carla None');
    const waiting = await makeAccount('Dina Waiting', 'ACTIVE');
    await staff.post(`/api/accounts/${waiting.id}/make-member`).send(FORM);
    const member = await makeAccount('Eli Member', 'ACTIVE');
    await prisma.account.update({ where: { id: member.id }, data: { isMember: true, membershipStatus: 'MEMBER', memberNumber: '0099' } });

    const rows = (await staff.get('/api/accounts')).body.rows as { id: number; canApply: boolean }[];
    const canApply = (id: number) => rows.find((r) => r.id === id)?.canApply;
    const others = rows.filter((r) => r.id !== ready.id);
    expect(canApply(ready.id)).toBe(true);
    // Pending installation, no connection, waiting for approval, and the member: no Apply.
    expect(others).toHaveLength(4);
    expect(others.every((r) => r.canApply === false)).toBe(true);
    expect(canApply(waiting.id)).toBe(false);
    expect(canApply(member.id)).toBe(false);
  });
});
