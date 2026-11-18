import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  addMonthsKeepDay,
  deductionsFor,
  effectiveMonthlyRate,
  installmentStates,
  monthlyPayment,
  monthsLate,
  payoff,
  penaltyFor,
  schedule,
  splitPayment,
  totalOwed,
} from '../services/loanMath';

const d = (v: string | number) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal) => v.toFixed(2);

describe('the Fixed Equal Amortization Schedule', () => {
  it('matches the 3,000 / 3% / 6-month example exactly, ending at 0.00', () => {
    expect(money(monthlyPayment(d(3000), d(3), 6))).toBe('553.79');
    const rows = schedule(d(3000), d(3), 6, '2026-01-15');
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => [money(r.interest), money(r.principal), money(r.amount), money(r.balanceAfter)])).toEqual([
      ['90.00', '463.79', '553.79', '2536.21'],
      ['76.09', '477.70', '553.79', '2058.51'],
      ['61.76', '492.03', '553.79', '1566.48'],
      ['46.99', '506.80', '553.79', '1059.68'],
      ['31.79', '522.00', '553.79', '537.68'],
      ['16.13', '537.68', '553.81', '0.00'],
    ]);
    // The principal adds up to the loan; the last installment takes the rounding.
    expect(money(rows.reduce((s, r) => s.plus(r.principal), d(0)))).toBe('3000.00');
  });

  it('never shows a negative balance, for many amounts, rates and terms', () => {
    for (const principal of [1, 999.99, 3000, 12345.67, 250000]) {
      for (const rate of [0, 0.5, 1.25, 3, 5]) {
        for (let n = 1; n <= 24; n++) {
          const rows = schedule(d(principal), d(rate), n, '2026-03-31');
          expect(rows.every((r) => r.balanceAfter.gte(0) && r.principal.gte(0))).toBe(true);
          expect(money(rows.at(-1)!.balanceAfter)).toBe('0.00');
          expect(money(rows.reduce((s, r) => s.plus(r.principal), d(0)))).toBe(d(principal).toFixed(2));
          expect(rows.length).toBeLessThanOrEqual(n);
        }
      }
    }
  });

  it('puts due dates on the same day each month, or the last day when the month is shorter', () => {
    expect(addMonthsKeepDay('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsKeepDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsKeepDay('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsKeepDay('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsKeepDay('2026-08-31', 1)).toBe('2026-09-30');
    expect(addMonthsKeepDay('2026-11-30', 3)).toBe('2027-02-28');
    expect(schedule(d(1000), d(3), 3, '2026-01-31').map((r) => r.dueDate)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('works out the deductions and net cash: 3,000 − 30 service charge − 30 TSC = 2,940', () => {
    const lines = deductionsFor(d(3000), { serviceChargePercent: d(1), tscType: 'AMOUNT', tscValue: d(30), notarialFee: d(0), otherChargeLabel: '', otherChargeAmount: d(0) });
    expect(lines.map((l) => [l.label, money(l.amount)])).toEqual([
      ['Service charge (1.00%)', '30.00'],
      ['TSC', '30.00'],
    ]);
    expect(money(lines.reduce((s, l) => s.minus(l.amount), d(3000)))).toBe('2940.00');
  });

  it('shows a higher effective rate than the stated rate because of the deductions', () => {
    const rows = schedule(d(3000), d(3), 6, '2026-01-15');
    expect(effectiveMonthlyRate(d(3000), rows)).toBeCloseTo(3, 1);
    expect(effectiveMonthlyRate(d(2940), rows)).toBeGreaterThan(3.5);
  });
});

describe('paying a loan', () => {
  const rows = schedule(d(3000), d(3), 6, '2026-01-15').map((r, i) => ({ ...r, id: i + 1 }));
  const none = { type: 'NONE', value: d(0) };

  it('splits a payment penalty → interest → principal, oldest installment first, and allows partial payments', () => {
    const states = installmentStates(rows, [], { type: 'PERCENT', value: d(2) }, '2026-02-20');
    // Installment 1 is late by part of a month: 2% of 553.79 = 11.08 penalty.
    const split = splitPayment(states, d(300));
    expect(split).toEqual([{ installmentId: 1, no: 1, penalty: d('11.08'), interest: d('90.00'), principal: d('198.92') }]);
  });

  it('carries an advance payment on to the next installments', () => {
    const states = installmentStates(rows, [], none, '2026-02-01');
    const split = splitPayment(states, d(700));
    expect(split.map((s) => [s.no, money(s.interest), money(s.principal)])).toEqual([
      [1, '90.00', '463.79'],
      [2, '76.09', '70.12'],
    ]);
  });

  it('counts what was already paid, and refuses more than is owed', () => {
    const states = installmentStates(rows, [{ installmentId: 1, date: '2026-02-10', penalty: d(0), interest: d(90), principal: d(100) }], none, '2026-02-20');
    expect(splitPayment(states, d(400))[0]).toMatchObject({ no: 1, interest: d(0), principal: d('363.79') });
    expect(money(totalOwed(states))).toBe(money(rows.reduce((s, r) => s.plus(r.amount), d(0)).minus(190)));
    expect(() => splitPayment(states, totalOwed(states).plus('0.01'))).toThrow(/more than/);
  });

  it('charges the penalty for each month or part of a month late, and stops once paid', () => {
    expect(monthsLate('2026-01-15', '2026-01-15')).toBe(0);
    expect(monthsLate('2026-01-15', '2026-01-16')).toBe(1);
    expect(monthsLate('2026-01-15', '2026-02-15')).toBe(1);
    expect(monthsLate('2026-01-15', '2026-02-16')).toBe(2);
    const inst = { dueDate: '2026-01-15', amount: d('553.79') };
    expect(money(penaltyFor({ type: 'AMOUNT', value: d(50) }, inst, null, '2026-03-01'))).toBe('100.00');
    expect(money(penaltyFor({ type: 'AMOUNT', value: d(50) }, inst, '2026-01-20', '2026-06-01'))).toBe('50.00');
    expect(money(penaltyFor(none, inst, null, '2027-01-01'))).toBe('0.00');
  });

  it('works out the early payoff: principal left + this month’s interest (or interest to date)', () => {
    const paidFirst = [{ installmentId: 1, date: '2026-02-15', penalty: d(0), interest: d(90), principal: d('463.79') }];
    const states = installmentStates(rows, paidFirst, none, '2026-02-20');
    const thisMonth = payoff(states, '2026-02-20', 'THIS_MONTH', '2026-01-15');
    expect(money(thisMonth.amount)).toBe('2612.30'); // 2,536.21 principal + 76.09 interest
    const toDate = payoff(states, '2026-02-20', 'TO_DATE', '2026-01-15');
    // 5 of 28 days in Feb 15 → Mar 15: 76.09 × 5 / 28 = 13.59
    expect(money(toDate.amount)).toBe('2549.80');
    expect(toDate.splits.reduce((s, x) => s.plus(x.principal), d(0)).toFixed(2)).toBe('2536.21');
  });
});
