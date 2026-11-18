import type { ReactNode } from 'react';
import { formatDate, peso } from '../lib/format';
import { INSTALLMENT, type Loan, type ScheduleRow } from '../lib/loans';
import { Badge } from './ui';

/** A big figure with a small label above it: "Monthly payment ₱553.79". */
export function Figure({ label, value, detail, tone }: { label: string; value: string; detail?: ReactNode; tone?: 'red' | 'green' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div>
      {detail && <div className="mt-1 text-slate-600">{detail}</div>}
    </div>
  );
}

/** The deductions and the cash the member receives. */
export function CashBreakdown({ principal, deductions, totalDeductions, netCash }: { principal: string; deductions: { label: string; amount: string }[]; totalDeductions: string; netCash: string }) {
  return (
    <dl className="divide-y divide-slate-100 text-lg">
      <div className="flex justify-between gap-4 py-1.5">
        <dt>Loan amount</dt>
        <dd className="font-semibold tabular-nums">{peso(principal)}</dd>
      </div>
      {deductions.map((d) => (
        <div key={d.label} className="flex justify-between gap-4 py-1.5 text-slate-700">
          <dt>Less {d.label}</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">− {peso(d.amount)}</dd>
        </div>
      ))}
      {deductions.length > 1 && (
        <div className="flex justify-between gap-4 py-1.5 text-slate-700">
          <dt>Total deductions</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">− {peso(totalDeductions)}</dd>
        </div>
      )}
      <div className="flex justify-between gap-4 py-2 text-xl font-bold">
        <dt>Cash to the member</dt>
        <dd className="tabular-nums">{peso(netCash)}</dd>
      </div>
    </dl>
  );
}

type Row = ScheduleRow & Partial<Pick<Loan['schedule'][number], 'status' | 'paid' | 'penaltyOwed'>>;

/**
 * The payment schedule. Five money columns at most, so it fits at 1366 × 768 and 125% zoom
 * without sideways scrolling. With `withStatus`, each row shows Paid / Due soon / Overdue.
 */
export function ScheduleTable({ rows, withStatus = false }: { rows: Row[]; withStatus?: boolean }) {
  const total = (k: 'principal' | 'interest' | 'amount') => rows.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <table className="w-full text-base">
      <thead className="border-b-2 border-slate-300 text-left text-sm uppercase tracking-wide text-slate-600">
        <tr>
          <th className="py-2 pr-2">No.</th>
          <th className="py-2 pr-2">Due date</th>
          <th className="py-2 pr-2 text-right">Principal</th>
          <th className="py-2 pr-2 text-right">Interest</th>
          <th className="py-2 pr-2 text-right">Payment</th>
          <th className="py-2 pr-2 text-right">Balance</th>
          {withStatus && <th className="py-2 text-right print:hidden">Status</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 tabular-nums">
        {rows.map((r) => (
          <tr key={r.no} className={r.status === 'OVERDUE' ? 'bg-red-50' : r.status === 'DUE_SOON' ? 'bg-amber-50' : ''}>
            <td className="py-2 pr-2">{r.no}</td>
            <td className="py-2 pr-2 whitespace-nowrap">{formatDate(r.dueDate)}</td>
            <td className="py-2 pr-2 text-right">{peso(r.principal)}</td>
            <td className="py-2 pr-2 text-right">{peso(r.interest)}</td>
            <td className="py-2 pr-2 text-right font-semibold">{peso(r.amount)}</td>
            <td className="py-2 pr-2 text-right">{peso(r.balanceAfter)}</td>
            {withStatus && (
              <td className="py-2 text-right print:hidden">
                {r.status && r.status !== 'NOT_RELEASED' && (
                  <Badge tone={INSTALLMENT[r.status].tone} small>
                    {r.status === 'PAID' ? 'Paid' : Number(r.paid) > 0 ? `${INSTALLMENT[r.status].label} · ${peso(r.paid ?? 0)} paid` : INSTALLMENT[r.status].label}
                  </Badge>
                )}
                {Number(r.penaltyOwed ?? 0) > 0 && <div className="text-sm text-red-700">+ {peso(r.penaltyOwed ?? 0)} penalty</div>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot className="border-t-2 border-slate-300 font-bold tabular-nums">
        <tr>
          <td className="py-2 pr-2" colSpan={2}>
            Total
          </td>
          <td className="py-2 pr-2 text-right">{peso(total('principal'))}</td>
          <td className="py-2 pr-2 text-right">{peso(total('interest'))}</td>
          <td className="py-2 pr-2 text-right">{peso(total('amount'))}</td>
          <td colSpan={withStatus ? 2 : 1} />
        </tr>
      </tfoot>
    </table>
  );
}
