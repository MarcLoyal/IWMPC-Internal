import { Prisma, type LoanStatus, type Role } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { formatDate, fromDbDate, isDateString, toDbDate, todayManila } from '../lib/dates';
import { formatPeso } from '../lib/money';
import { addDays } from '../lib/periods';
import { audit } from './audit';
import { getSettings } from './settings';
import { nextNumber } from './numbering';
import {
  cents,
  deductionsFor,
  effectiveMonthlyRate,
  installmentStates,
  payoff,
  schedule,
  splitPayment,
  totalOwed,
  unpaid,
  type InstallmentState,
  type PayoffRule,
  type Split,
} from './loanMath';

type D = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);
const sum = (xs: D[]) => xs.reduce((a, b) => a.plus(b), ZERO);
/** "This week" on lists and Home: today and the next 6 days. */
export const DUE_SOON_DAYS = 7;

// ---- Loan types ---------------------------------------------------------------------------------

/** The loan type IWMPC starts with. Added once, if there are no loan types yet. */
export async function ensureDefaultLoanTypes(db: Db) {
  if ((await db.loanType.count()) > 0) return;
  await db.loanType.create({ data: { name: 'Credit Loan' } });
}

export function loanTypeJson(t: Prisma.LoanTypeGetPayload<object>) {
  return {
    id: t.id,
    name: t.name,
    monthlyRate: t.monthlyRate.toFixed(2),
    method: t.method,
    minMonths: t.minMonths,
    maxMonths: t.maxMonths,
    serviceChargePercent: t.serviceChargePercent.toFixed(2),
    tscType: t.tscType,
    tscValue: t.tscValue.toFixed(2),
    notarialFee: t.notarialFee.toFixed(2),
    otherChargeLabel: t.otherChargeLabel,
    otherChargeAmount: t.otherChargeAmount.toFixed(2),
    penaltyType: t.penaltyType,
    penaltyValue: t.penaltyValue.toFixed(2),
    active: t.active,
  };
}

// ---- How much a member can borrow ----------------------------------------------------------------

/** Paid-up share capital: the opening balance from the paper records + Share Capital payments. */
export async function paidUpShareCapital(db: Db, accountId: number): Promise<D> {
  const [account, paid] = await Promise.all([
    db.account.findUnique({ where: { id: accountId }, select: { openingShareCapital: true } }),
    db.payment.aggregate({ where: { accountId, type: 'SHARE_CAPITAL', status: 'ACTIVE' }, _sum: { amount: true } }),
  ]);
  return (account?.openingShareCapital ?? ZERO).plus(paid._sum.amount ?? ZERO);
}

const OPEN: LoanStatus[] = ['FOR_APPROVAL', 'APPROVED', 'RELEASED'];

/**
 * Principal the member still owes or has asked for: unpaid principal of released loans, plus the
 * full amount of loans waiting for approval or release (so two applications cannot both use the
 * same limit).
 */
async function principalInUse(db: Db, accountId: number, exceptLoanId?: number): Promise<D> {
  const loans = await db.loan.findMany({
    where: { accountId, status: { in: OPEN }, ...(exceptLoanId ? { NOT: { id: exceptLoanId } } : {}) },
    include: { paymentLines: { where: { payment: { status: 'ACTIVE' } } } },
  });
  return sum(loans.map((l) => (l.status === 'RELEASED' ? l.principal.minus(sum(l.paymentLines.map((x) => x.principal))) : l.principal)));
}

export async function borrowLimit(db: Db, accountId: number, exceptLoanId?: number) {
  const [account, settings, paidUp, inUse] = await Promise.all([
    db.account.findUnique({ where: { id: accountId }, select: { isMember: true } }),
    getSettings(db),
    paidUpShareCapital(db, accountId),
    principalInUse(db, accountId, exceptLoanId),
  ]);
  if (!account) throw notFound('This account');
  const percent = Number(settings.loan_limit_percent) || 0;
  const ofShares = cents(paidUp.mul(percent).div(100));
  const limit = account.isMember ? Prisma.Decimal.max(ZERO, ofShares.minus(inUse)) : ZERO;
  return { isMember: account.isMember, percent, paidUp, ofShares, inUse, limit };
}

type Limit = Awaited<ReturnType<typeof borrowLimit>>;

export function limitJson(l: Limit) {
  return { isMember: l.isMember, percent: l.percent, paidUp: l.paidUp.toFixed(2), ofShares: l.ofShares.toFixed(2), inUse: l.inUse.toFixed(2), limit: l.limit.toFixed(2) };
}

/** "Maximum for this member is ₱X (70% of share capital ₱Y)." */
export function overLimitMessage(l: Limit) {
  const owed = l.inUse.gt(0) ? `, less ${formatPeso(l.inUse)} on their other loans` : '';
  return `Maximum for this member is ${formatPeso(l.limit)} (${l.percent}% of share capital ${formatPeso(l.paidUp)}${owed}).`;
}

// ---- Working out a loan --------------------------------------------------------------------------

export interface LoanRequest {
  accountId: number;
  loanTypeId: number;
  amount: D;
  months: number;
  purpose: string;
  /** Admin only: why this loan may go above the limit. */
  overLimitReason?: string;
}

/** Everything the review screen shows. The schedule's dates assume the loan is released `startDate`. */
export async function quote(db: Db, req: LoanRequest, startDate = todayManila()) {
  const type = await db.loanType.findUnique({ where: { id: req.loanTypeId } });
  if (!type || !type.active) throw new AppError(400, 'Please choose a loan type.');
  if (!Number.isInteger(req.months) || req.months < type.minMonths || req.months > type.maxMonths) {
    throw new AppError(400, `${type.name}: please choose ${type.minMonths} to ${type.maxMonths} months.`);
  }
  if (req.amount.lte(0)) throw new AppError(400, 'Please enter the loan amount.');
  const principal = cents(req.amount);
  const rows = schedule(principal, type.monthlyRate, req.months, startDate);
  const deductions = deductionsFor(principal, type);
  const totalDeductions = sum(deductions.map((d) => d.amount));
  const netCash = principal.minus(totalDeductions);
  if (netCash.lte(0)) throw new AppError(400, 'The deductions are more than the loan. Please enter a bigger amount.');
  const totalInterest = sum(rows.map((r) => r.interest));
  return {
    type,
    principal,
    rows,
    deductions,
    totalDeductions,
    netCash,
    totalInterest,
    monthlyPayment: rows[0].amount,
    effectiveRate: effectiveMonthlyRate(netCash, rows),
  };
}

export function quoteJson(q: Awaited<ReturnType<typeof quote>>) {
  return {
    loanType: loanTypeJson(q.type),
    principal: q.principal.toFixed(2),
    monthlyRate: q.type.monthlyRate.toFixed(2),
    months: q.rows.length,
    monthlyPayment: q.monthlyPayment.toFixed(2),
    totalInterest: q.totalInterest.toFixed(2),
    totalToPay: q.principal.plus(q.totalInterest).toFixed(2),
    deductions: q.deductions.map((d) => ({ label: d.label, amount: d.amount.toFixed(2) })),
    totalDeductions: q.totalDeductions.toFixed(2),
    netCash: q.netCash.toFixed(2),
    effectiveRate: q.effectiveRate.toFixed(2),
    schedule: q.rows.map((r) => ({ no: r.no, dueDate: r.dueDate, principal: r.principal.toFixed(2), interest: r.interest.toFixed(2), amount: r.amount.toFixed(2), balanceAfter: r.balanceAfter.toFixed(2) })),
  };
}

/** Member, limit and Admin override checks shared by applying and approving. */
function checkLimit(limit: Limit, principal: D, override: { role: Role; reason: string } | null) {
  if (!limit.isMember) throw new AppError(400, 'Only members can borrow. Make this account a member first.');
  if (principal.gt(limit.limit)) {
    if (!override?.reason) throw new AppError(400, overLimitMessage(limit));
    if (override.role !== 'ADMIN') throw new AppError(403, `${overLimitMessage(limit)} Only an Admin can go above it.`);
  }
}

// ---- The workflow --------------------------------------------------------------------------------

export const loanInclude = {
  account: { include: { area: true } },
  installments: { orderBy: { no: 'asc' } },
  deductions: { orderBy: { id: 'asc' } },
  paymentLines: { include: { payment: { select: { id: true, status: true, paymentDate: true, orNumber: true, amount: true } } } },
  createdBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  releasedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
} satisfies Prisma.LoanInclude;

export type FullLoan = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

export async function applyForLoan(req: LoanRequest, user: { id: number; role: Role }) {
  return prisma.$transaction(async (tx) => {
    // One application at a time per member, so two cannot use the same limit.
    await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${req.accountId} FOR UPDATE`;
    const limit = await borrowLimit(tx, req.accountId);
    const q = await quote(tx, req);
    const reason = req.overLimitReason?.trim() ?? '';
    checkLimit(limit, q.principal, q.principal.gt(limit.limit) ? { role: user.role, reason } : null);
    const loan = await tx.loan.create({
      data: {
        number: await nextNumber(tx, 'loan'),
        accountId: req.accountId,
        loanTypeId: q.type.id,
        typeName: q.type.name,
        monthlyRate: q.type.monthlyRate,
        method: q.type.method,
        penaltyType: q.type.penaltyType,
        penaltyValue: q.type.penaltyValue,
        months: q.rows.length,
        principal: q.principal,
        monthlyPayment: q.monthlyPayment,
        totalInterest: q.totalInterest,
        totalDeductions: q.totalDeductions,
        netCash: q.netCash,
        purpose: req.purpose.trim(),
        limitAtApply: limit.limit,
        overLimitReason: q.principal.gt(limit.limit) ? reason : null,
        createdById: user.id,
        installments: {
          create: q.rows.map((r) => ({ no: r.no, dueDate: toDbDate(r.dueDate), principal: r.principal, interest: r.interest, amount: r.amount, balanceAfter: r.balanceAfter })),
        },
        deductions: { create: q.deductions.map((d) => ({ label: d.label, amount: d.amount })) },
      },
    });
    await audit(tx, user.id, 'loan.apply', 'loan', loan.id, null, {
      number: loan.number,
      accountId: loan.accountId,
      typeName: loan.typeName,
      principal: loan.principal,
      months: loan.months,
      monthlyPayment: loan.monthlyPayment,
      netCash: loan.netCash,
      limit: limit.limit,
      overLimitReason: loan.overLimitReason,
    });
    return loan;
  });
}

async function lockLoan(tx: Prisma.TransactionClient, id: number) {
  await tx.$queryRaw`SELECT id FROM loans WHERE id = ${id} FOR UPDATE`;
  const loan = await tx.loan.findUnique({ where: { id } });
  if (!loan) throw notFound('This loan');
  return loan;
}

const STATUS_WORDS: Record<LoanStatus, string> = {
  FOR_APPROVAL: 'waiting for approval',
  APPROVED: 'approved and waiting for release',
  RELEASED: 'released',
  PAID: 'fully paid',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

function expect(loan: { status: LoanStatus; number: string }, status: LoanStatus) {
  if (loan.status !== status) throw new AppError(409, `Loan ${loan.number} is ${STATUS_WORDS[loan.status]}.`);
}

export async function approveLoan(id: number, user: { id: number; role: Role }) {
  return prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, id);
    expect(loan, 'FOR_APPROVAL');
    if (loan.createdById === user.id) throw new AppError(403, 'You made this loan, so someone else must approve it.');
    // The member's share capital or other loans may have changed since they applied.
    const limit = await borrowLimit(tx, loan.accountId, loan.id);
    if (loan.principal.gt(limit.limit) && !loan.overLimitReason) {
      throw new AppError(400, `${overLimitMessage(limit)} Reject this loan, or ask the Loan Officer to make a new one.`);
    }
    if (!limit.isMember) throw new AppError(400, 'This account is no longer a member, so the loan cannot be approved.');
    const updated = await tx.loan.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: user.id } });
    await audit(tx, user.id, 'loan.approve', 'loan', id, { status: loan.status }, { status: updated.status, number: loan.number, principal: loan.principal });
    return updated;
  });
}

export async function rejectLoan(id: number, reason: string, user: { id: number }) {
  if (!reason.trim()) throw new AppError(400, 'Please type the reason for rejecting this loan.');
  return prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, id);
    expect(loan, 'FOR_APPROVAL');
    if (loan.createdById === user.id) throw new AppError(403, 'You made this loan, so someone else must decide on it.');
    const updated = await tx.loan.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date(), decidedById: user.id, rejectReason: reason.trim() } });
    await audit(tx, user.id, 'loan.reject', 'loan', id, { status: loan.status }, { status: updated.status, number: loan.number, rejectReason: updated.rejectReason });
    return updated;
  });
}

/** The person who made it, or an Admin, may cancel a loan before the cash is released. */
export async function cancelLoan(id: number, reason: string, user: { id: number; role: Role }) {
  if (!reason.trim()) throw new AppError(400, 'Please type the reason for cancelling this loan.');
  return prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, id);
    if (loan.status !== 'FOR_APPROVAL' && loan.status !== 'APPROVED') throw new AppError(409, `Loan ${loan.number} is ${STATUS_WORDS[loan.status]} and can no longer be cancelled.`);
    if (user.role !== 'ADMIN' && loan.createdById !== user.id) throw new AppError(403, 'Only the person who made this loan, or an Admin, can cancel it.');
    const updated = await tx.loan.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason.trim() } });
    await audit(tx, user.id, 'loan.cancel', 'loan', id, { status: loan.status }, { status: updated.status, number: loan.number, cancelReason: updated.cancelReason });
    return updated;
  });
}

/** The Cashier gives the member the cash. The due dates count from the release date. */
export async function releaseLoan(id: number, input: { releaseDate: string; cashGiven: D }, user: { id: number }) {
  if (!isDateString(input.releaseDate)) throw new AppError(400, 'Please choose the date the cash was given.');
  if (input.releaseDate > todayManila()) throw new AppError(400, 'The release date cannot be in the future.');
  return prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, id);
    expect(loan, 'APPROVED');
    if (loan.createdById === user.id) throw new AppError(403, 'You made this loan, so someone else must release it.');
    if (input.releaseDate < todayManila(loan.createdAt)) {
      throw new AppError(400, 'The release date cannot be before the loan was applied for.');
    }
    if (!cents(input.cashGiven).equals(loan.netCash)) {
      throw new AppError(400, `The cash given must be ${formatPeso(loan.netCash)}: the loan less the deductions.`);
    }
    // Same amounts, new dates.
    const rows = schedule(loan.principal, loan.monthlyRate, loan.months, input.releaseDate);
    const installments = await tx.loanInstallment.findMany({ where: { loanId: id }, orderBy: { no: 'asc' } });
    for (const inst of installments) {
      const row = rows.find((r) => r.no === inst.no);
      if (row) await tx.loanInstallment.update({ where: { id: inst.id }, data: { dueDate: toDbDate(row.dueDate) } });
    }
    const updated = await tx.loan.update({
      where: { id },
      data: { status: 'RELEASED', releaseDate: toDbDate(input.releaseDate), cashGiven: loan.netCash, releasedAt: new Date(), releasedById: user.id },
    });
    await audit(tx, user.id, 'loan.release', 'loan', id, { status: loan.status }, {
      status: updated.status,
      number: loan.number,
      releaseDate: input.releaseDate,
      cashGiven: loan.netCash,
      totalDeductions: loan.totalDeductions,
    });
    return updated;
  });
}

// ---- A loan's state: what is paid, due and late --------------------------------------------------

type LoanForState = Pick<FullLoan, 'status' | 'penaltyType' | 'penaltyValue' | 'paidOn' | 'releaseDate' | 'createdAt' | 'installments' | 'paymentLines'>;

/** Installments with what was paid, as of `asOf` (a paid loan stops counting penalties when it was paid). */
export function statesOf(loan: LoanForState, asOf = todayManila()): InstallmentState[] {
  const lines = loan.paymentLines
    .filter((l) => l.payment.status === 'ACTIVE')
    .map((l) => ({ installmentId: l.installmentId, date: fromDbDate(l.payment.paymentDate)!, penalty: l.penalty, interest: l.interest, principal: l.principal }));
  const until = loan.paidOn ? fromDbDate(loan.paidOn)! : asOf;
  return installmentStates(
    loan.installments.map((i) => ({ id: i.id, no: i.no, dueDate: fromDbDate(i.dueDate)!, principal: i.principal, interest: i.interest, amount: i.amount })),
    lines,
    { type: loan.penaltyType, value: loan.penaltyValue },
    until,
  );
}

export type Standing = 'PAID' | 'OVERDUE' | 'DUE_SOON' | 'UP_TO_DATE' | 'NOT_RELEASED';

/** The figures shown on cards and lists. */
export function summaryOf(loan: LoanForState, today = todayManila()) {
  const states = statesOf(loan, today);
  const owedOn = (s: InstallmentState) => unpaid.penalty(s).plus(unpaid.interest(s)).plus(unpaid.principal(s));
  const open = states.filter((s) => owedOn(s).gt(0));
  const overdue = open.filter((s) => s.dueDate < today);
  const next = open[0] ?? null;
  const soonLimit = addDays(today, DUE_SOON_DAYS - 1);
  const balance = sum(states.map(unpaid.principal));
  let standing: Standing;
  if (loan.status === 'PAID') standing = 'PAID';
  else if (loan.status !== 'RELEASED') standing = 'NOT_RELEASED';
  else if (overdue.length) standing = 'OVERDUE';
  else if (next && next.dueDate <= soonLimit) standing = 'DUE_SOON';
  else standing = 'UP_TO_DATE';
  // Due now: everything late; if nothing is late, the next installment.
  const dueNow = overdue.length ? sum(overdue.map(owedOn)) : next ? owedOn(next) : ZERO;
  return {
    states,
    standing,
    balance,
    totalOwed: totalOwed(states),
    overdueAmount: sum(overdue.map(owedOn)),
    overdueCount: overdue.length,
    next: next ? { no: next.no, dueDate: next.dueDate, amount: owedOn(next) } : null,
    dueNow,
    paidSoFar: sum(loan.paymentLines.filter((l) => l.payment.status === 'ACTIVE').map((l) => l.penalty.plus(l.interest).plus(l.principal))),
  };
}

export function payoffOf(loan: LoanForState & { releaseDate: Date | null }, rule: PayoffRule, today = todayManila()) {
  const start = loan.releaseDate ? fromDbDate(loan.releaseDate)! : today;
  return payoff(statesOf(loan, today), today, rule, start);
}

const installmentStatus = (s: InstallmentState, today: string, loanPaid: boolean) => {
  const owed = unpaid.penalty(s).plus(unpaid.interest(s)).plus(unpaid.principal(s));
  if (loanPaid || owed.lte(0)) return 'PAID';
  if (s.dueDate < today) return 'OVERDUE';
  if (s.dueDate <= addDays(today, DUE_SOON_DAYS - 1)) return 'DUE_SOON';
  return 'UPCOMING';
};

/** A loan for the screens: details, schedule with each installment's status, and payments. */
export async function loanJson(loan: FullLoan, opts: { withPayoff?: boolean } = {}) {
  const today = todayManila();
  const s = summaryOf(loan, today);
  const settings = await getSettings(prisma);
  const rule = settings.loan_payoff_rule as PayoffRule;
  const paid = loan.status === 'PAID';
  const byPayment = new Map<number, { id: number; date: string; number: string; status: string; amount: D; penalty: D; interest: D; principal: D }>();
  for (const l of loan.paymentLines) {
    const p = byPayment.get(l.payment.id) ?? { id: l.payment.id, date: fromDbDate(l.payment.paymentDate)!, number: l.payment.orNumber.split('#')[0], status: l.payment.status, amount: l.payment.amount, penalty: ZERO, interest: ZERO, principal: ZERO };
    p.penalty = p.penalty.plus(l.penalty);
    p.interest = p.interest.plus(l.interest);
    p.principal = p.principal.plus(l.principal);
    byPayment.set(l.payment.id, p);
  }
  const who = (u: { id: number; name: string } | null) => u?.name ?? null;
  return {
    id: loan.id,
    number: loan.number,
    status: loan.status,
    standing: s.standing,
    account: { id: loan.account.id, fullName: loan.account.fullName, accountNumber: loan.account.accountNumber, memberNumber: loan.account.memberNumber, address: loan.account.address, area: loan.account.area.name },
    typeName: loan.typeName,
    monthlyRate: loan.monthlyRate.toFixed(2),
    months: loan.months,
    principal: loan.principal.toFixed(2),
    monthlyPayment: loan.monthlyPayment.toFixed(2),
    totalInterest: loan.totalInterest.toFixed(2),
    totalToPay: loan.principal.plus(loan.totalInterest).toFixed(2),
    deductions: loan.deductions.map((d) => ({ label: d.label, amount: d.amount.toFixed(2) })),
    totalDeductions: loan.totalDeductions.toFixed(2),
    netCash: loan.netCash.toFixed(2),
    effectiveRate: effectiveMonthlyRate(loan.netCash, loan.installments).toFixed(2),
    penaltyType: loan.penaltyType,
    penaltyValue: loan.penaltyValue.toFixed(2),
    purpose: loan.purpose,
    limitAtApply: loan.limitAtApply.toFixed(2),
    overLimitReason: loan.overLimitReason,
    createdAt: loan.createdAt.toISOString(),
    createdBy: who(loan.createdBy),
    createdById: loan.createdById,
    decidedAt: loan.decidedAt?.toISOString() ?? null,
    decidedBy: who(loan.decidedBy),
    rejectReason: loan.rejectReason,
    releaseDate: fromDbDate(loan.releaseDate),
    releasedBy: who(loan.releasedBy),
    cancelledAt: loan.cancelledAt?.toISOString() ?? null,
    cancelledBy: who(loan.cancelledBy),
    cancelReason: loan.cancelReason,
    paidOn: fromDbDate(loan.paidOn),
    dueDate: loan.installments.length ? fromDbDate(loan.installments[loan.installments.length - 1].dueDate) : null,
    balance: s.balance.toFixed(2),
    totalOwed: s.totalOwed.toFixed(2),
    overdueAmount: s.overdueAmount.toFixed(2),
    overdueCount: s.overdueCount,
    next: s.next ? { no: s.next.no, dueDate: s.next.dueDate, amount: s.next.amount.toFixed(2) } : null,
    dueNow: s.dueNow.toFixed(2),
    paidSoFar: s.paidSoFar.toFixed(2),
    payoff: opts.withPayoff && loan.status === 'RELEASED' ? { rule, amount: payoffOf(loan, rule, today).amount.toFixed(2) } : null,
    schedule: s.states.map((st) => ({
      no: st.no,
      dueDate: st.dueDate,
      principal: st.principal.toFixed(2),
      interest: st.interest.toFixed(2),
      amount: st.amount.toFixed(2),
      balanceAfter: loan.installments.find((i) => i.id === st.id)!.balanceAfter.toFixed(2),
      paid: st.paidPrincipal.plus(st.paidInterest).toFixed(2),
      penaltyOwed: unpaid.penalty(st).toFixed(2),
      status: loan.status === 'RELEASED' || paid ? installmentStatus(st, today, paid) : 'NOT_RELEASED',
    })),
    payments: [...byPayment.values()]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((p) => ({ id: p.id, date: p.date, number: p.number, status: p.status, amount: p.amount.toFixed(2), penalty: p.penalty.toFixed(2), interest: p.interest.toFixed(2), principal: p.principal.toFixed(2) })),
  };
}

// ---- Paying a loan at the Cashier ----------------------------------------------------------------

/** Loans the Cashier can take a payment for: what is due now, and the payoff amount. */
export async function loanOwed(db: Db, accountId: number) {
  const settings = await getSettings(db);
  const rule = settings.loan_payoff_rule as PayoffRule;
  const loans = await db.loan.findMany({ where: { accountId, status: 'RELEASED' }, include: loanInclude, orderBy: { id: 'asc' } });
  return loans.map((loan) => {
    const s = summaryOf(loan);
    const late = s.overdueCount > 0 ? `, ${s.overdueCount} overdue` : '';
    const when = s.next ? ` · installment ${s.next.no} of ${loan.months}, due ${formatDate(s.next.dueDate)}${late}` : '';
    return {
      type: 'LOAN' as const,
      loanId: loan.id,
      label: `Loan ${loan.number}${when}`,
      amount: s.dueNow.toFixed(2),
      payoffAmount: payoffOf(loan, rule).amount.toFixed(2),
      balance: s.totalOwed.toFixed(2),
      status: s.standing,
    };
  });
}

/** How a payment of `amount` would be split (or the payoff, when `isPayoff`). Shown before saving too. */
export function splitFor(loan: FullLoan, amount: D, isPayoff: boolean, rule: PayoffRule, today = todayManila()): Split[] {
  if (loan.status !== 'RELEASED') throw new AppError(400, `Loan ${loan.number} is ${STATUS_WORDS[loan.status]}, so it cannot be paid now.`);
  if (isPayoff) {
    const p = payoffOf(loan, rule, today);
    if (!cents(amount).equals(p.amount)) throw new AppError(409, `The amount to pay off loan ${loan.number} is now ${formatPeso(p.amount)}. Please check and try again.`);
    return p.splits;
  }
  const states = statesOf(loan, today);
  const owed = totalOwed(states);
  if (cents(amount).gt(owed)) {
    throw new AppError(400, `That is more than the ${formatPeso(owed)} left on loan ${loan.number}. To finish the loan early, use "Pay off the loan".`);
  }
  return splitPayment(states, cents(amount));
}

/** Saves a loan payment's split, inside the invoice's transaction, then marks the loan paid if it is. */
export async function addLoanLines(tx: Prisma.TransactionClient, paymentId: number, loanId: number, splits: Split[], paymentDate: string) {
  for (const s of splits) {
    await tx.loanPaymentLine.create({ data: { paymentId, loanId, installmentId: s.installmentId, penalty: s.penalty, interest: s.interest, principal: s.principal } });
  }
  await refreshLoanPaid(tx, loanId, paymentDate);
}

/**
 * A released loan becomes PAID when no principal is left and no penalty is owed; a voided payment
 * can turn it back to RELEASED. (A payoff waives the later months' interest, so only principal and
 * penalty decide.)
 */
export async function refreshLoanPaid(tx: Prisma.TransactionClient, loanId: number, paidOn = todayManila()) {
  const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: loanInclude });
  if (loan.status !== 'RELEASED' && loan.status !== 'PAID') return;
  const states = statesOf({ ...loan, paidOn: null }, paidOn);
  const done = sum(states.map(unpaid.principal)).isZero() && sum(states.map(unpaid.penalty)).isZero();
  if (done && loan.status === 'RELEASED') await tx.loan.update({ where: { id: loanId }, data: { status: 'PAID', paidOn: toDbDate(paidOn) } });
  if (!done && loan.status === 'PAID') await tx.loan.update({ where: { id: loanId }, data: { status: 'RELEASED', paidOn: null } });
}

// ---- Opening share capital -----------------------------------------------------------------------

/** Admin: the share capital a member paid before the system (from the paper records). */
export async function setOpeningShareCapital(accountId: number, amount: D, reason: string, userId: number) {
  if (!reason.trim()) throw new AppError(400, 'Please type the reason, for example "From the share capital ledger".');
  if (amount.lt(0)) throw new AppError(400, 'The amount cannot be below zero.');
  return prisma.$transaction(async (tx) => {
    const before = await tx.account.findUnique({ where: { id: accountId } });
    if (!before) throw notFound('This account');
    const after = await tx.account.update({ where: { id: accountId }, data: { openingShareCapital: cents(amount) } });
    await audit(tx, userId, 'share-capital.opening', 'account', accountId, { openingShareCapital: before.openingShareCapital }, { openingShareCapital: after.openingShareCapital, reason: reason.trim() });
    return after;
  });
}
