import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime, peso } from '../lib/format';
import { LOAN_STATUS, PAYOFF_RULE, STANDING, type Loan } from '../lib/loans';
import { useLoad } from '../lib/useLoad';
import { CashBreakdown, Figure, ScheduleTable } from '../components/LoanParts';
import { Badge, Button, Card, Detail, Field, LinkButton, Loading, Notice, PageHeader } from '../components/ui';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export function LoanView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: loan, error, loading, reload } = useLoad<Loan>(`/loans/${id}`);

  if (loading && !loan) return <Loading what="the loan" />;
  if (error && !loan) return <Notice tone="error">{error}</Notice>;
  if (!loan) return null;
  const released = loan.status === 'RELEASED' || loan.status === 'PAID';

  return (
    <>
      <PageHeader
        title={`Loan ${loan.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to={`/accounts/${loan.account.id}`} className="font-semibold text-brand-700 underline">
              {loan.account.fullName}
            </Link>
            <span>
              {loan.account.accountNumber} · {loan.account.area}
            </span>
            <Badge tone={LOAN_STATUS[loan.status].tone}>{LOAN_STATUS[loan.status].label}</Badge>
            {loan.status === 'RELEASED' && <Badge tone={STANDING[loan.standing].tone}>{STANDING[loan.standing].label}</Badge>}
          </span>
        }
        back={{ to: '/loans', label: 'Back to Loans' }}
      >
        <LinkButton to={`/loans/${loan.id}/print/schedule`}>Print Schedule</LinkButton>
        <LinkButton to={`/loans/${loan.id}/print/disclosure`}>Print Disclosure</LinkButton>
      </PageHeader>

      {params.get('new') && loan.status === 'FOR_APPROVAL' && (
        <Notice tone="success" className="mb-4">
          Loan {loan.number} was submitted for approval.
        </Notice>
      )}

      <Actions loan={loan} onDone={reload} />

      {released ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Loan balance" value={peso(loan.balance)} detail={`of ${peso(loan.principal)} borrowed`} tone={loan.status === 'PAID' ? 'green' : undefined} />
          {loan.status === 'PAID' ? (
            <Figure label="Fully paid" value={formatDate(loan.paidOn)} tone="green" />
          ) : (
            <Figure
              label="Next due"
              value={loan.next ? peso(loan.next.amount) : '—'}
              detail={loan.next ? `Installment ${loan.next.no} of ${loan.months}, ${formatDate(loan.next.dueDate)}` : undefined}
            />
          )}
          <Figure
            label="Overdue"
            value={peso(loan.overdueAmount)}
            tone={Number(loan.overdueAmount) > 0 ? 'red' : 'green'}
            detail={loan.overdueCount === 0 ? 'Nothing late' : `${loan.overdueCount} ${loan.overdueCount === 1 ? 'installment' : 'installments'} late`}
          />
          {loan.payoff ? (
            <Figure label="To pay off today" value={peso(loan.payoff.amount)} detail={PAYOFF_RULE[loan.payoff.rule]} />
          ) : (
            <Figure label="Paid so far" value={peso(loan.paidSoFar)} />
          )}
        </div>
      ) : (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Monthly payment" value={peso(loan.monthlyPayment)} detail={`${loan.months} months`} />
          <Figure label="Total interest" value={peso(loan.totalInterest)} detail={`${loan.monthlyRate}% a month`} />
          <Figure label="Deductions" value={peso(loan.totalDeductions)} />
          <Figure label="Cash to receive" value={peso(loan.netCash)} tone="green" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-2 text-xl font-bold">{loan.typeName}</h2>
            <CashBreakdown principal={loan.principal} deductions={loan.deductions} totalDeductions={loan.totalDeductions} netCash={loan.netCash} />
          </Card>
          <Card className="p-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Interest">{`${loan.monthlyRate}% a month · effective ${loan.effectiveRate}%`}</Detail>
              <Detail label="Monthly payment">{`${peso(loan.monthlyPayment)} × ${loan.months}`}</Detail>
              <Detail label="Applied">{`${formatDateTime(loan.createdAt)} by ${loan.createdBy ?? '—'}`}</Detail>
              {loan.decidedAt && <Detail label={loan.status === 'REJECTED' ? 'Rejected' : 'Approved'}>{`${formatDateTime(loan.decidedAt)} by ${loan.decidedBy ?? '—'}`}</Detail>}
              {loan.releaseDate && <Detail label="Cash given">{`${formatDate(loan.releaseDate)} by ${loan.releasedBy ?? '—'}`}</Detail>}
              {loan.dueDate && <Detail label="Last due date">{formatDate(loan.dueDate)}</Detail>}
              {loan.purpose && <Detail label="Purpose">{loan.purpose}</Detail>}
              <Detail label="Late penalty">
                {loan.penaltyType === 'NONE' ? 'None' : loan.penaltyType === 'PERCENT' ? `${loan.penaltyValue}% of the installment a month` : `${peso(loan.penaltyValue)} a month per installment`}
              </Detail>
            </dl>
            {loan.overLimitReason && (
              <Notice tone="warning" className="mt-4">
                Above the limit of {peso(loan.limitAtApply)}. Admin reason: {loan.overLimitReason}
              </Notice>
            )}
            {loan.rejectReason && (
              <Notice tone="warning" className="mt-4">
                Rejected: {loan.rejectReason}
              </Notice>
            )}
            {loan.cancelReason && (
              <Notice tone="warning" className="mt-4">
                Cancelled {formatDateTime(loan.cancelledAt)} by {loan.cancelledBy}: {loan.cancelReason}
              </Notice>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-2 text-xl font-bold">Payment schedule</h2>
            {!released && <p className="mb-2 text-slate-600">The due dates are set again from the day the cash is given.</p>}
            <ScheduleTable rows={loan.schedule} withStatus={released} />
          </Card>
          {released && (
            <Card className="p-5">
              <h2 className="mb-2 text-xl font-bold">Payments</h2>
              {loan.payments.length === 0 ? (
                <p className="text-slate-600">No payments yet.</p>
              ) : (
                <table className="w-full text-base">
                  <thead className="border-b-2 border-slate-300 text-left text-sm uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Invoice No.</th>
                      <th className="py-2 pr-2 text-right">Amount</th>
                      <th className="py-2 text-right">Penalty · Interest · Principal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {loan.payments.map((p) => (
                      <tr key={p.id} className={p.status === 'VOID' ? 'text-slate-400 line-through' : ''}>
                        <td className="py-2 pr-2 whitespace-nowrap">{formatDate(p.date)}</td>
                        <td className="py-2 pr-2">
                          {p.number}
                          {p.status === 'VOID' && <span className="ml-2 no-underline">(void)</span>}
                        </td>
                        <td className="py-2 pr-2 text-right font-semibold">{peso(p.amount)}</td>
                        <td className="py-2 text-right text-slate-700">
                          {peso(p.penalty)} · {peso(p.interest)} · {peso(p.principal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** What the person looking at the loan can do now. Each one is also checked by the server. */
function Actions({ loan, onDone }: { loan: Loan; onDone: () => void }) {
  const { user, can, canDo } = useAuth();
  const [mode, setMode] = useState<'' | 'reject' | 'cancel'>('');
  const [reason, setReason] = useState('');
  const [releaseDate, setReleaseDate] = useState(today());
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = loan.createdById === user?.id;

  async function run(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/loans/${loan.id}/${path}`, body);
      setMode('');
      setReason('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canDecide = loan.status === 'FOR_APPROVAL' && canDo('APPROVE_LOANS');
  const canRelease = loan.status === 'APPROVED' && canDo('CASHIER');
  const canCancel = (loan.status === 'FOR_APPROVAL' || loan.status === 'APPROVED') && canDo('LOANS') && (mine || can('ADMIN'));
  if (!canDecide && !canRelease && !canCancel && loan.status !== 'RELEASED') return null;

  return (
    <div className="mb-5 space-y-3">
      {canDecide && mine && <Notice tone="info">You made this loan, so someone else must approve or reject it.</Notice>}
      {canDecide && !mine && mode !== 'reject' && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-amber-300 bg-amber-50 p-5">
          <div className="text-lg">
            <strong>For approval.</strong> {loan.account.fullName} asks for {peso(loan.principal)} over {loan.months} months.
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="success" className="px-8 py-3 text-lg" onClick={() => run('approve')} disabled={busy}>
              Approve
            </Button>
            <Button variant="danger" className="px-8 py-3 text-lg" onClick={() => setMode('reject')} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}
      {(mode === 'reject' || mode === 'cancel') && (
        <Card className="p-5">
          <Field label={mode === 'reject' ? 'Reason for rejecting (required)' : 'Reason for cancelling (required)'}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => run(mode, { reason })} disabled={busy || !reason.trim()}>
              {mode === 'reject' ? 'Reject the loan' : 'Cancel the loan'}
            </Button>
            <Button onClick={() => setMode('')} disabled={busy}>
              Back
            </Button>
          </div>
        </Card>
      )}
      {canRelease && mine && <Notice tone="info">You made this loan, so someone else must give the cash.</Notice>}
      {canRelease && !mine && (
        <Card className="border-brand-300 bg-brand-50 p-5">
          <h2 className="text-xl font-bold">Approved: ready to release</h2>
          <p className="mt-1 text-lg">
            Give <strong className="tabular-nums">{peso(loan.netCash)}</strong> in cash to {loan.account.fullName}. The deductions ({peso(loan.totalDeductions)}) stay with the cooperative.
          </p>
          <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Date the cash was given">
              <input className="input" type="date" max={today()} value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
            </Field>
            <Field label="Cash given" hint={`Type ${peso(loan.netCash)} to confirm.`}>
              <input className="input text-xl font-bold tabular-nums" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <Button variant="primary" className="mt-4 px-8 py-3 text-lg" onClick={() => run('release', { releaseDate, cashGiven: cash.replace(/[₱,\s]/g, '') })} disabled={busy || !cash.trim()}>
            {busy ? 'Saving…' : 'Record the release'}
          </Button>
        </Card>
      )}
      {loan.status === 'RELEASED' && canDo('CASHIER') && (
        <div>
          <LinkButton to={`/cashier?account=${loan.account.id}`} variant="primary">
            Take a payment at the Cashier
          </LinkButton>
        </div>
      )}
      {canCancel && mode === '' && (
        <button type="button" className="font-semibold text-red-700 underline" onClick={() => setMode('cancel')}>
          Cancel this loan
        </button>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
