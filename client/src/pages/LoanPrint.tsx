import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { formatDate, peso } from '../lib/format';
import type { Loan } from '../lib/loans';
import type { Settings } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Loading, Notice, PageHeader, PrintButton } from '../components/ui';

/** Printable Schedule of Payment and Disclosure Statement. Normal printouts, not BIR invoices. */
export function LoanPrint() {
  const { id, kind } = useParams();
  const { data: loan, error, loading } = useLoad<Loan>(`/loans/${id}`);
  const settings = useLoad<Settings>('/settings');
  if (loading && !loan) return <Loading what="the loan" />;
  if (error && !loan) return <Notice tone="error">{error}</Notice>;
  if (!loan) return null;
  const disclosure = kind === 'disclosure';

  return (
    <>
      <PageHeader title={disclosure ? 'Disclosure Statement' : 'Schedule of Payment'} back={{ to: `/loans/${loan.id}`, label: `Back to loan ${loan.number}` }}>
        <PrintButton />
      </PageHeader>
      {loan.status !== 'RELEASED' && loan.status !== 'PAID' && (
        <Notice tone="info" className="no-print mb-4">
          The cash has not been given yet. The due dates shown assume the loan is released on the day it was applied for, and are set again on release.
        </Notice>
      )}
      <div className="mx-auto max-w-[8in] bg-white p-8 text-[15px] text-black shadow-sm print:p-0 print:shadow-none">
        <div className="mb-4 text-center">
          <img src="/logo.png" alt="" className="mx-auto mb-1 h-14 w-14" />
          <div className="text-lg font-bold uppercase">{settings.data?.coop_name}</div>
          <div>{settings.data?.coop_address}</div>
          {settings.data?.coop_cda_no && <div className="text-sm">CDA Reg. No. {settings.data.coop_cda_no}</div>}
          <div className="mt-3 text-xl font-bold tracking-wide">{disclosure ? 'DISCLOSURE STATEMENT' : 'SCHEDULE OF PAYMENT'}</div>
          <div className="text-sm">{loan.typeName} · Fixed Equal Amortization · Loan No. {loan.number}</div>
        </div>
        {disclosure ? <Disclosure loan={loan} /> : <Schedule loan={loan} />}
        <div className="mt-14 grid grid-cols-2 gap-12">
          <Signature label="Borrower" name={loan.account.fullName} />
          <Signature label="Loan Officer" name={loan.createdBy ?? ''} />
        </div>
      </div>
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 border-b border-slate-300 py-1">
      <span className="w-44 shrink-0 font-semibold">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function Signature({ label, name }: { label: string; name: string }) {
  return (
    <div className="text-center">
      <div className="border-b border-black pb-0.5 font-semibold uppercase">{name}</div>
      <div className="text-sm">{label} · signature over printed name</div>
    </div>
  );
}

const granted = (loan: Loan) => (loan.releaseDate ? formatDate(loan.releaseDate) : 'On release');

function Schedule({ loan }: { loan: Loan }) {
  const charges = loan.deductions.map((d) => `${d.label} ${peso(d.amount)}`).join('; ') || 'None';
  return (
    <>
      <div className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <Line label="Name of member">{loan.account.fullName}</Line>
          <Line label="Address">{loan.account.address || loan.account.area}</Line>
          <Line label="Date granted">{granted(loan)}</Line>
          <Line label="Date due">{formatDate(loan.dueDate)}</Line>
        </div>
        <div>
          <Line label="Loan amount">{peso(loan.principal)}</Line>
          <Line label="Monthly installment">{peso(loan.monthlyPayment)}</Line>
          <Line label="Interest rate">{loan.monthlyRate}% a month</Line>
          <Line label="Net cash">{peso(loan.netCash)}</Line>
        </div>
      </div>
      <div className="mt-1 border-b border-slate-300 py-1">
        <span className="font-semibold">Charges: </span>
        {charges}
      </div>
      <table className="mt-5 w-full border-collapse text-[14px] tabular-nums">
        <thead>
          <tr className="border-y-2 border-black text-left">
            <th className="py-1 pr-1">Period</th>
            <th className="py-1 pr-1">Due date</th>
            <th className="py-1 pr-1 text-right">Principal</th>
            <th className="py-1 pr-1 text-right">Interest</th>
            <th className="py-1 pr-1 text-right">Other charges</th>
            <th className="py-1 pr-1 text-right">Payment</th>
            <th className="py-1 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-300">
            <td className="py-1" colSpan={6}>
              Loan granted
            </td>
            <td className="py-1 text-right">{peso(loan.principal)}</td>
          </tr>
          {loan.schedule.map((r) => (
            <tr key={r.no} className="border-b border-slate-300">
              <td className="py-1 pr-1">{r.no}</td>
              <td className="py-1 pr-1 whitespace-nowrap">{formatDate(r.dueDate)}</td>
              <td className="py-1 pr-1 text-right">{peso(r.principal)}</td>
              <td className="py-1 pr-1 text-right">{peso(r.interest)}</td>
              <td className="py-1 pr-1 text-right">—</td>
              <td className="py-1 pr-1 text-right font-semibold">{peso(r.amount)}</td>
              <td className="py-1 text-right">{peso(r.balanceAfter)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-y-2 border-black font-bold">
            <td className="py-1" colSpan={2}>
              Total
            </td>
            <td className="py-1 pr-1 text-right">{peso(loan.principal)}</td>
            <td className="py-1 pr-1 text-right">{peso(loan.totalInterest)}</td>
            <td className="py-1 pr-1 text-right">—</td>
            <td className="py-1 pr-1 text-right">{peso(loan.totalToPay)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {loan.penaltyType !== 'NONE' && (
        <p className="mt-2 text-sm">
          Late payment: {loan.penaltyType === 'PERCENT' ? `${loan.penaltyValue}% of the installment` : peso(loan.penaltyValue)} for each month or part of a month late.
        </p>
      )}
    </>
  );
}

function Disclosure({ loan }: { loan: Loan }) {
  const finance = Number(loan.totalInterest) + Number(loan.totalDeductions);
  const first = loan.schedule[0];
  return (
    <>
      <Line label="Borrower">{loan.account.fullName}</Line>
      <Line label="Address">{loan.account.address || loan.account.area}</Line>
      <Line label="Date granted">{granted(loan)}</Line>

      <h3 className="mt-5 text-base font-bold uppercase">1. Amount of the loan</h3>
      <Line label="Loan amount">{peso(loan.principal)}</Line>

      <h3 className="mt-5 text-base font-bold uppercase">2. Finance charges</h3>
      <Line label="Interest">
        {peso(loan.totalInterest)} ({loan.monthlyRate}% a month, diminishing balance)
      </Line>
      {loan.deductions.map((d) => (
        <Line key={d.label} label={d.label}>
          {peso(d.amount)}
        </Line>
      ))}
      <Line label="Total finance charges">
        <strong>{peso(finance)}</strong>
      </Line>

      <h3 className="mt-5 text-base font-bold uppercase">3. Net proceeds of the loan</h3>
      <Line label="Loan amount">{peso(loan.principal)}</Line>
      <Line label="Less deductions">− {peso(loan.totalDeductions)}</Line>
      <Line label="Net proceeds">
        <strong>{peso(loan.netCash)}</strong>
      </Line>

      <h3 className="mt-5 text-base font-bold uppercase">4. Interest rate</h3>
      <Line label="Stated rate">{loan.monthlyRate}% a month</Line>
      <Line label="Effective rate">
        {loan.effectiveRate}% a month (counting the deductions)
      </Line>

      <h3 className="mt-5 text-base font-bold uppercase">5. Payment schedule</h3>
      <Line label="Number of payments">{loan.months} monthly</Line>
      <Line label="Each payment">
        {peso(loan.monthlyPayment)}
        {loan.schedule.length > 1 && loan.schedule[loan.schedule.length - 1].amount !== loan.monthlyPayment && ` (last: ${peso(loan.schedule[loan.schedule.length - 1].amount)})`}
      </Line>
      <Line label="First payment due">{formatDate(first?.dueDate)}</Line>
      <Line label="Last payment due">{formatDate(loan.dueDate)}</Line>
      <Line label="Total of payments">
        <strong>{peso(loan.totalToPay)}</strong>
      </Line>
      {loan.penaltyType !== 'NONE' && (
        <Line label="Late payment">
          {loan.penaltyType === 'PERCENT' ? `${loan.penaltyValue}% of the installment` : peso(loan.penaltyValue)} for each month or part of a month late
        </Line>
      )}
      <p className="mt-6 text-sm">I acknowledge that I received a copy of this statement and the payment schedule before the loan was granted.</p>
    </>
  );
}
