import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { todayManila, toDbDate } from '../lib/dates';
import { addDays } from '../lib/periods';
import { loginAs, makeAccount, resetDb } from './helpers';

beforeEach(resetDb);

const userId = async (role: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${role.toLowerCase()}@test.local` } })).id;
const creditLoan = async () => (await prisma.loanType.findFirstOrThrow({ where: { name: 'Credit Loan' } })).id;

/** A member with share capital paid before the system. */
async function member(name: string, shareCapital: string) {
  const account = await makeAccount(name);
  return prisma.account.update({ where: { id: account.id }, data: { isMember: true, membershipStatus: 'MEMBER', memberNumber: `M-${account.id}`, openingShareCapital: shareCapital } });
}

async function apply(accountId: number, amount = '3000', months = 6, extra: Record<string, unknown> = {}) {
  const officer = await loginAs('LOAN_OFFICER');
  return officer.post('/api/loans').send({ accountId, loanTypeId: await creditLoan(), amount, months, purpose: 'Farm inputs', ...extra });
}

/** Applied by the Loan Officer, approved by the Admin, released by the Cashier today. */
async function releasedLoan(accountId: number, amount = '3000', months = 6) {
  const applied = await apply(accountId, amount, months);
  expect(applied.status).toBe(201);
  const admin = await loginAs('ADMIN');
  expect((await admin.post(`/api/loans/${applied.body.id}/approve`)).status).toBe(200);
  const cashier = await loginAs('CASHIER');
  const released = await cashier.post(`/api/loans/${applied.body.id}/release`).send({ releaseDate: todayManila(), cashGiven: applied.body.netCash });
  expect(released.status).toBe(200);
  return released.body;
}

let invoiceNo = 30000;
async function pay(accountId: number, loanId: number, amount: string, payoff = false) {
  const cashier = await loginAs('CASHIER');
  return cashier.post('/api/invoices').send({ accountId, number: String(++invoiceNo), items: [{ type: 'LOAN', loanId, amount, payoff }] });
}

describe('can borrow up to', () => {
  it('is 70% of paid-up share capital, less the unpaid principal of active loans', async () => {
    const m = await member('Juan Dela Cruz', '5000.00');
    const cashier = await loginAs('CASHIER');
    expect((await cashier.post('/api/invoices').send({ accountId: m.id, number: '20001', items: [{ type: 'SHARE_CAPITAL', amount: '1000' }] })).status).toBe(201);

    const first = await cashier.get(`/api/loans/member/${m.id}`);
    expect(first.body.limit).toMatchObject({ isMember: true, percent: 70, paidUp: '6000.00', ofShares: '4200.00', inUse: '0.00', limit: '4200.00' });

    await releasedLoan(m.id, '3000');
    expect((await cashier.get(`/api/loans/member/${m.id}`)).body.limit).toMatchObject({ inUse: '3000.00', limit: '1200.00' });

    // A loan waiting for approval also counts, so two applications cannot share the limit.
    expect((await apply(m.id, '1000')).status).toBe(201);
    expect((await cashier.get(`/api/loans/member/${m.id}`)).body.limit).toMatchObject({ inUse: '4000.00', limit: '200.00' });

    // A voided share capital payment no longer counts.
    const sc = await prisma.payment.findFirstOrThrow({ where: { type: 'SHARE_CAPITAL' } });
    const admin = await loginAs('ADMIN');
    await admin.post(`/api/payments/${sc.id}/void`).send({ reason: 'Wrong member' });
    expect((await cashier.get(`/api/loans/member/${m.id}`)).body.limit).toMatchObject({ paidUp: '5000.00', limit: '0.00' });
  });

  it('follows the Admin setting, which needs a reason and keeps its history', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const admin = await loginAs('ADMIN');
    expect((await admin.put('/api/settings').send({ loan_limit_percent: '50' })).status).toBe(400);
    expect((await admin.put('/api/settings').send({ loan_limit_percent: '50', reason: 'Board resolution 7' })).status).toBe(200);
    expect((await admin.get(`/api/loans/member/${m.id}`)).body.limit.limit).toBe('5000.00');
    expect(await prisma.settingChange.count({ where: { key: 'loan_limit_percent' } })).toBe(1);
  });

  it('blocks non-members', async () => {
    const account = await makeAccount('Pedro Penduko');
    const res = await apply(account.id, '1000');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only members can borrow/);
    expect(await prisma.loan.count()).toBe(0);
  });

  it('blocks an amount above the limit with a clear message; only an Admin may go above it, with a reason', async () => {
    const m = await member('Juan Dela Cruz', '4000.00');
    const over = await apply(m.id, '3000');
    expect(over.status).toBe(400);
    expect(over.body.error).toBe('Maximum for this member is ₱2,800.00 (70% of share capital ₱4,000.00).');

    expect((await apply(m.id, '3000', 6, { overLimitReason: 'Board approved' })).status).toBe(403);

    const admin = await loginAs('ADMIN');
    const ok = await admin.post('/api/loans').send({ accountId: m.id, loanTypeId: await creditLoan(), amount: '3000', months: 6, overLimitReason: 'Board resolution 12' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ overLimitReason: 'Board resolution 12', limitAtApply: '2800.00' });
    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: 'loan.apply' } });
    expect(logged.after).toMatchObject({ overLimitReason: 'Board resolution 12' });
  });
});

describe('who can do what (checked on the server)', () => {
  it('a Loan Officer cannot approve, release or take payments; nobody approves their own loan', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const applied = await apply(m.id);
    const officer = await loginAs('LOAN_OFFICER');
    expect((await officer.post(`/api/loans/${applied.body.id}/approve`)).status).toBe(403);
    expect((await officer.post(`/api/loans/${applied.body.id}/reject`).send({ reason: 'x' })).status).toBe(403);

    // An Admin who made a loan cannot approve it either.
    const admin = await loginAs('ADMIN');
    const own = await admin.post('/api/loans').send({ accountId: m.id, loanTypeId: await creditLoan(), amount: '1000', months: 3 });
    const selfApprove = await admin.post(`/api/loans/${own.body.id}/approve`);
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error).toMatch(/someone else must approve/);

    await admin.post(`/api/loans/${applied.body.id}/approve`);
    expect((await officer.post(`/api/loans/${applied.body.id}/release`).send({ releaseDate: todayManila(), cashGiven: applied.body.netCash })).status).toBe(403);
    const cashier = await loginAs('CASHIER');
    await cashier.post(`/api/loans/${applied.body.id}/release`).send({ releaseDate: todayManila(), cashGiven: applied.body.netCash });
    expect((await officer.post('/api/invoices').send({ accountId: m.id, number: '1', items: [{ type: 'LOAN', loanId: applied.body.id, amount: '100' }] })).status).toBe(403);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('Board can view loans but not make, approve or release them; Cashier and Staff cannot make loans', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const applied = await apply(m.id);
    const board = await loginAs('BOARD');
    expect((await board.get(`/api/loans/${applied.body.id}`)).status).toBe(200);
    expect((await board.get('/api/loans')).status).toBe(200);
    expect((await board.post(`/api/loans/${applied.body.id}/approve`)).status).toBe(403);
    for (const role of ['BOARD', 'CASHIER', 'STAFF'] as const) {
      const res = await (await loginAs(role)).post('/api/loans').send({ accountId: m.id, loanTypeId: await creditLoan(), amount: '500', months: 2 });
      expect(res.status).toBe(403);
    }
  });

  it('lets a Manager approve through the "Approve loans" switch, which a Loan Officer or Cashier can never get', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const applied = await apply(m.id);
    const admin = await loginAs('ADMIN');
    const grant = (role: string) => ({ work: 'APPROVE_LOANS', requestedBy: 'Board', reason: `Manager ${role}` });
    expect((await admin.post(`/api/users/${await userId('STAFF')}/access`).send(grant('staff'))).status).toBe(201);
    for (const role of ['LOAN_OFFICER', 'CASHIER']) {
      const res = await admin.post(`/api/users/${await userId(role)}/access`).send(grant(role));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/keep duties apart/);
    }
    expect((await admin.post(`/api/users/${await userId('LOAN_OFFICER')}/access`).send({ ...grant('x'), work: 'CASHIER' })).status).toBe(400);
    const manager = await loginAs('STAFF');
    expect((await manager.post(`/api/loans/${applied.body.id}/approve`)).status).toBe(200);
  });
});

describe('the loan from application to fully paid', () => {
  it('matches the 3,000 / 3% / 6 example, releases 2,940 cash, and dates the schedule from the release', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const officer = await loginAs('LOAN_OFFICER');
    const q = await officer.post('/api/loans/quote').send({ accountId: m.id, loanTypeId: await creditLoan(), amount: '3000', months: 6 });
    expect(q.body).toMatchObject({ monthlyPayment: '553.79', netCash: '2940.00', totalDeductions: '60.00', overLimit: false });
    expect(q.body.schedule[0]).toMatchObject({ interest: '90.00', principal: '463.79', balanceAfter: '2536.21' });
    expect(q.body.schedule.at(-1).balanceAfter).toBe('0.00');
    expect(q.body.deductions).toEqual([{ label: 'Service charge (1.00%)', amount: '30.00' }, { label: 'TSC', amount: '30.00' }]);

    const loan = await releasedLoan(m.id);
    expect(loan).toMatchObject({ status: 'RELEASED', netCash: '2940.00', releaseDate: todayManila(), balance: '3000.00' });
    const release = todayManila();
    expect(loan.schedule[0].dueDate > release).toBe(true);
    expect(loan.schedule.every((s: { balanceAfter: string }) => Number(s.balanceAfter) >= 0)).toBe(true);

    // The cash must be exactly the net proceeds.
    const other = await releasedLoanAttempt(m.id, '2000.00');
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/must be ₱1,950.00/);
  });

  it('handles a release on the 31st: the next due dates fall on the last day of shorter months', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const applied = await apply(m.id, '1000', 3);
    await prisma.loan.update({ where: { id: applied.body.id }, data: { createdAt: new Date('2026-01-02T00:00:00Z') } });
    const admin = await loginAs('ADMIN');
    await admin.post(`/api/loans/${applied.body.id}/approve`);
    const cashier = await loginAs('CASHIER');
    const res = await cashier.post(`/api/loans/${applied.body.id}/release`).send({ releaseDate: '2026-01-31', cashGiven: applied.body.netCash });
    expect(res.status).toBe(200);
    expect(res.body.schedule.map((s: { dueDate: string }) => s.dueDate)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('splits payments interest → principal on the invoice guide (C, C1), allows part and advance payments, and pays off early', async () => {
    const m = await member('Juan Dela Cruz', '10000.00');
    const loan = await releasedLoan(m.id);

    const part = await pay(m.id, loan.id, '300');
    expect(part.status).toBe(201);
    expect(part.body.guide).toMatchObject({ loans: '210.00', loanInterest: '90.00', loanPenalty: null, totalAmountDue: '300.00' });

    // 253.79 finishes installment 1; the other 300 goes on to installment 2 (interest first).
    const advance = await pay(m.id, loan.id, '553.79');
    expect(advance.body.guide).toMatchObject({ loans: '477.70', loanInterest: '76.09' });
    const after = (await (await loginAs('CASHIER')).get(`/api/loans/${loan.id}`)).body;
    expect(after.schedule[0]).toMatchObject({ status: 'PAID' });
    expect(after.balance).toBe('2312.30');

    // Pay off: principal left + this month's interest (the default rule).
    expect(after.payoff.rule).toBe('THIS_MONTH');
    const tooMuch = await pay(m.id, loan.id, '99999');
    expect(tooMuch.body.error).toMatch(/Pay off the loan/);
    const off = await pay(m.id, loan.id, after.payoff.amount, true);
    expect(off.status).toBe(201);
    const paid = (await (await loginAs('CASHIER')).get(`/api/loans/${loan.id}`)).body;
    expect(paid).toMatchObject({ status: 'PAID', balance: '0.00', paidOn: todayManila() });
    expect(paid.schedule.every((s: { status: string }) => s.status === 'PAID')).toBe(true);

    // Voiding the payoff makes the loan owing again.
    const admin = await loginAs('ADMIN');
    const payoffPayment = await prisma.payment.findFirstOrThrow({ where: { type: 'LOAN' }, orderBy: { id: 'desc' } });
    expect((await admin.post(`/api/payments/${payoffPayment.id}/void`).send({ reason: 'Wrong amount' })).status).toBe(200);
    expect((await admin.get(`/api/loans/${loan.id}`)).body).toMatchObject({ status: 'RELEASED', balance: '2312.30', paidOn: null });
  });

  it('takes penalty first, then interest, then principal, when an installment is late (C2 on the guide)', async () => {
    const type = await prisma.loanType.update({ where: { id: await creditLoan() }, data: { penaltyType: 'PERCENT', penaltyValue: '2' } });
    const m = await member('Juan Dela Cruz', '10000.00');
    const loan = await releasedLoan(m.id);
    expect(type.penaltyType).toBe('PERCENT');
    // Make installment 1 a few days late.
    const first = await prisma.loanInstallment.findFirstOrThrow({ where: { loanId: loan.id, no: 1 } });
    await prisma.loanInstallment.update({ where: { id: first.id }, data: { dueDate: toDbDate(addDays(todayManila(), -3)) } });

    const view = (await (await loginAs('CASHIER')).get(`/api/loans/${loan.id}`)).body;
    expect(view).toMatchObject({ standing: 'OVERDUE', overdueCount: 1, overdueAmount: '564.87' });
    const res = await pay(m.id, loan.id, '100');
    expect(res.body.guide).toMatchObject({ loanPenalty: '11.08', loanInterest: '88.92', loans: null });
  });
});

describe('Home and profile figures', () => {
  it('match the loan records', async () => {
    const a = await member('Juan Dela Cruz', '10000.00');
    const b = await member('Maria Santos', '10000.00');
    const loanA = await releasedLoan(a.id, '3000', 6);
    await releasedLoan(b.id, '1000', 2);
    await apply(b.id, '500', 2);
    // Loan A's first installment becomes overdue; B's first is due this week.
    const firstA = await prisma.loanInstallment.findFirstOrThrow({ where: { loanId: loanA.id, no: 1 } });
    await prisma.loanInstallment.update({ where: { id: firstA.id }, data: { dueDate: toDbDate(addDays(todayManila(), -1)) } });
    const loanB = await prisma.loan.findFirstOrThrow({ where: { accountId: b.id, status: 'RELEASED' } });
    const firstB = await prisma.loanInstallment.findFirstOrThrow({ where: { loanId: loanB.id, no: 1 } });
    await prisma.loanInstallment.update({ where: { id: firstB.id }, data: { dueDate: toDbDate(addDays(todayManila(), 2)) } });

    const admin = await loginAs('ADMIN');
    const home = (await admin.get('/api/loans/summary')).body;
    expect(home).toMatchObject({
      active: { count: 2, balance: '4000.00' },
      overdue: { count: 1, amount: '553.79' },
      dueThisWeek: { count: 1, amount: firstB.amount.toFixed(2) },
      forApproval: 1,
      readyToRelease: 0,
    });
    // Cards for approvers only.
    expect((await (await loginAs('LOAN_OFFICER')).get('/api/loans/summary')).body.forApproval).toBeNull();

    const profile = (await admin.get(`/api/loans/member/${a.id}`)).body;
    expect(profile.loans[0]).toMatchObject({ balance: '3000.00', standing: 'OVERDUE', next: { no: 1, amount: '553.79' } });
    expect(profile.limit.limit).toBe(new Prisma.Decimal(7000).minus(3000).toFixed(2));

    const overdue = (await admin.get('/api/loans?due=OVERDUE')).body.loans;
    expect(overdue.map((l: { id: number }) => l.id)).toEqual([loanA.id]);
    const week = (await admin.get('/api/loans?due=WEEK')).body.loans;
    expect(week.map((l: { id: number }) => l.id)).toEqual([loanB.id]);

    // The Cashier sees the loan under "What they owe".
    const owed = (await (await loginAs('CASHIER')).get(`/api/accounts/${a.id}`)).body.owed;
    expect(owed).toContainEqual(expect.objectContaining({ type: 'LOAN', loanId: loanA.id, amount: '553.79' }));
  });
});

async function releasedLoanAttempt(accountId: number, amount: string) {
  const applied = await apply(accountId, amount, 3);
  const admin = await loginAs('ADMIN');
  await admin.post(`/api/loans/${applied.body.id}/approve`);
  const cashier = await loginAs('CASHIER');
  return cashier.post(`/api/loans/${applied.body.id}/release`).send({ releaseDate: todayManila(), cashGiven: '2000.00' });
}
