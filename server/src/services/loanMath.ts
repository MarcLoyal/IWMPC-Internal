import { Prisma } from '@prisma/client';

/*
 * Loan arithmetic, matching IWMPC's "Fixed Equal Amortization Schedule": diminishing balance,
 * equal monthly payments. Pure functions (no database), so every figure can be tested exactly.
 */

type D = Prisma.Decimal;
const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = dec(0);
/** Round to the centavo, halves up (₱0.005 -> ₱0.01). */
export const cents = (v: D) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface Row {
  no: number;
  dueDate: string;
  principal: D;
  interest: D;
  amount: D;
  balanceAfter: D;
}

/** monthly payment = P × r / (1 − (1 + r)^−n), rounded to the centavo. r is the monthly rate as a fraction. */
export function monthlyPayment(principal: D, monthlyRatePercent: D, months: number): D {
  const r = monthlyRatePercent.div(100);
  if (r.isZero()) return cents(principal.div(months));
  return cents(principal.mul(r).div(dec(1).minus(dec(1).plus(r).pow(-months))));
}

/** Last day of a month (1-12). */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The due date `k` months after `start` (YYYY-MM-DD), on the same day of the month. If that day
 * does not exist (e.g. the 31st in February), the last day of that month.
 */
export function addMonthsKeepDay(start: string, k: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const index = y * 12 + (m - 1) + k;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(d, lastDay(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The full schedule. Each month: interest = balance × r (to the centavo), principal = payment −
 * interest. The last installment takes whatever is left, so the balance ends at exactly 0.00 and
 * never goes below it.
 */
export function schedule(principal: D, monthlyRatePercent: D, months: number, startDate: string): Row[] {
  if (!Number.isInteger(months) || months < 1) throw new Error('months must be a whole number of at least 1');
  const r = monthlyRatePercent.div(100);
  const payment = monthlyPayment(principal, monthlyRatePercent, months);
  const rows: Row[] = [];
  let balance = cents(principal);
  for (let no = 1; no <= months && balance.gt(0); no++) {
    const interest = cents(balance.mul(r));
    let toPrincipal = payment.minus(interest);
    // The last month (or a month that would overpay) clears exactly what is left.
    if (no === months || toPrincipal.gte(balance)) toPrincipal = balance;
    if (toPrincipal.lt(0)) toPrincipal = ZERO;
    balance = balance.minus(toPrincipal);
    rows.push({ no, dueDate: addMonthsKeepDay(startDate, no), principal: toPrincipal, interest, amount: toPrincipal.plus(interest), balanceAfter: balance });
  }
  return rows;
}

export interface LoanTerms {
  serviceChargePercent: D;
  tscType: string;
  tscValue: D;
  notarialFee: D;
  otherChargeLabel: string;
  otherChargeAmount: D;
}

/** What is taken from the loan at release. Only lines above zero are listed. */
export function deductionsFor(principal: D, t: LoanTerms): { label: string; amount: D }[] {
  const lines = [
    { label: `Service charge (${t.serviceChargePercent.toFixed(2)}%)`, amount: cents(principal.mul(t.serviceChargePercent).div(100)) },
    { label: t.tscType === 'PERCENT' ? `TSC (${t.tscValue.toFixed(2)}%)` : 'TSC', amount: t.tscType === 'PERCENT' ? cents(principal.mul(t.tscValue).div(100)) : cents(t.tscValue) },
    { label: 'Notarial fee', amount: cents(t.notarialFee) },
    { label: t.otherChargeLabel.trim() || 'Other charge', amount: cents(t.otherChargeAmount) },
  ];
  return lines.filter((l) => l.amount.gt(0));
}

/**
 * The effective interest rate per month: the rate at which the payments are worth exactly the cash
 * the member received. Higher than the stated rate because of the deductions.
 */
export function effectiveMonthlyRate(netCash: D, rows: Pick<Row, 'amount'>[]): number {
  const net = Number(netCash);
  const pays = rows.map((r) => Number(r.amount));
  const worth = (i: number) => pays.reduce((sum, p, k) => sum + p / Math.pow(1 + i, k + 1), 0);
  if (net <= 0 || worth(0) <= net) return 0;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 100; step++) {
    const mid = (lo + hi) / 2;
    if (worth(mid) > net) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1_000_000) / 10_000; // percent, 2 decimals kept precise
}

// ---- Payments -----------------------------------------------------------------------------------

export interface InstallmentState {
  id: number;
  no: number;
  dueDate: string;
  principal: D;
  interest: D;
  amount: D;
  paidPrincipal: D;
  paidInterest: D;
  paidPenalty: D;
  /** Penalty charged so far, as of the date asked. */
  penaltyCharged: D;
}

export interface PaidLine {
  installmentId: number;
  date: string;
  penalty: D;
  interest: D;
  principal: D;
}

export interface PenaltyRule {
  type: string; // NONE | PERCENT | AMOUNT
  value: D;
}

/** Months, or part of a month, from `due` to `until` (0 if not late). Jan 15 → Jan 16 = 1, → Feb 16 = 2. */
export function monthsLate(due: string, until: string): number {
  if (until <= due) return 0;
  let n = 0;
  while (addMonthsKeepDay(due, n) < until) n += 1;
  return n;
}

/** Penalty for one installment, as of `asOf`: counted until it was fully paid, or until `asOf`. */
export function penaltyFor(rule: PenaltyRule, inst: { dueDate: string; amount: D }, fullyPaidOn: string | null, asOf: string): D {
  if (rule.type === 'NONE' || rule.value.lte(0)) return ZERO;
  const late = monthsLate(inst.dueDate, fullyPaidOn ?? asOf);
  if (!late) return ZERO;
  const each = rule.type === 'PERCENT' ? cents(inst.amount.mul(rule.value).div(100)) : cents(rule.value);
  return each.mul(late);
}

/** Each installment with what was paid on it and the penalty charged, as of `asOf`. */
export function installmentStates(
  rows: { id: number; no: number; dueDate: string; principal: D; interest: D; amount: D }[],
  lines: PaidLine[],
  rule: PenaltyRule,
  asOf: string,
): InstallmentState[] {
  return rows
    .slice()
    .sort((a, b) => a.no - b.no)
    .map((row) => {
      const mine = lines.filter((l) => l.installmentId === row.id).sort((a, b) => a.date.localeCompare(b.date));
      let paidPrincipal = ZERO;
      let paidInterest = ZERO;
      let paidPenalty = ZERO;
      let fullyPaidOn: string | null = null;
      for (const l of mine) {
        paidPrincipal = paidPrincipal.plus(l.principal);
        paidInterest = paidInterest.plus(l.interest);
        paidPenalty = paidPenalty.plus(l.penalty);
        if (!fullyPaidOn && paidPrincipal.plus(paidInterest).gte(row.amount)) fullyPaidOn = l.date;
      }
      return { ...row, paidPrincipal, paidInterest, paidPenalty, penaltyCharged: penaltyFor(rule, row, fullyPaidOn, asOf) };
    });
}

export const unpaid = {
  principal: (s: InstallmentState) => Prisma.Decimal.max(ZERO, s.principal.minus(s.paidPrincipal)),
  interest: (s: InstallmentState) => Prisma.Decimal.max(ZERO, s.interest.minus(s.paidInterest)),
  penalty: (s: InstallmentState) => Prisma.Decimal.max(ZERO, s.penaltyCharged.minus(s.paidPenalty)),
};

export interface Split {
  installmentId: number;
  no: number;
  penalty: D;
  interest: D;
  principal: D;
}

/** What is still owed on the whole schedule (penalty + interest + principal). */
export function totalOwed(states: InstallmentState[]): D {
  return states.reduce((sum, s) => sum.plus(unpaid.penalty(s)).plus(unpaid.interest(s)).plus(unpaid.principal(s)), ZERO);
}

/**
 * Splits a payment: installment by installment, oldest first, each one penalty → interest →
 * principal. A partial payment stops part-way; an advance payment carries on to later installments.
 */
export function splitPayment(states: InstallmentState[], amount: D): Split[] {
  if (amount.lte(0)) throw new Error('amount must be above zero');
  if (amount.gt(totalOwed(states))) throw new Error('amount is more than what is owed');
  let left = amount;
  const out: Split[] = [];
  for (const s of states) {
    if (left.lte(0)) break;
    const take = (owed: D) => {
      const t = Prisma.Decimal.min(owed, left);
      left = left.minus(t);
      return t;
    };
    const penalty = take(unpaid.penalty(s));
    const interest = take(unpaid.interest(s));
    const principal = take(unpaid.principal(s));
    if (penalty.gt(0) || interest.gt(0) || principal.gt(0)) out.push({ installmentId: s.id, no: s.no, penalty, interest, principal });
  }
  return out;
}

export type PayoffRule = 'THIS_MONTH' | 'TO_DATE';

/**
 * Paying the whole loan early: every penalty, the interest of installments already due, the
 * current month's interest (THIS_MONTH: in full; TO_DATE: for the days so far), and all the
 * principal left. The interest of later months is not charged.
 */
export function payoff(states: InstallmentState[], asOf: string, rule: PayoffRule, startDate: string): { amount: D; splits: Split[] } {
  const splits: Split[] = [];
  let currentSeen = false;
  let previousDue = startDate;
  for (const s of states) {
    const due = s.dueDate <= asOf;
    let interest = ZERO;
    if (due) interest = unpaid.interest(s);
    else if (!currentSeen) {
      currentSeen = true;
      if (rule === 'THIS_MONTH') interest = unpaid.interest(s);
      else {
        const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
        const period = Math.max(1, days(previousDue, s.dueDate));
        const sofar = Math.min(period, Math.max(0, days(previousDue, asOf)));
        interest = Prisma.Decimal.max(ZERO, cents(s.interest.mul(sofar).div(period)).minus(s.paidInterest));
      }
    }
    previousDue = s.dueDate;
    const penalty = unpaid.penalty(s);
    const principal = unpaid.principal(s);
    if (penalty.gt(0) || interest.gt(0) || principal.gt(0)) splits.push({ installmentId: s.id, no: s.no, penalty, interest, principal });
  }
  const amount = splits.reduce((sum, x) => sum.plus(x.penalty).plus(x.interest).plus(x.principal), ZERO);
  return { amount, splits };
}
