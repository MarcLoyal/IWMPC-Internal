import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, peso } from '../lib/format';
import { LOAN_STATUS, STANDING, STANDING_BORDER, type Loan, type MemberLoans, type Standing, shareCapitalParts } from '../lib/loans';
import { ScheduleTable } from './LoanParts';
import { Badge, Button, Card, Field, LinkButton, Notice } from './ui';

const WORST: Standing[] = ['OVERDUE', 'DUE_SOON', 'UP_TO_DATE', 'PAID', 'NOT_RELEASED'];

/** The summary card on the profile: "Loan balance ₱X · Next due [date] ₱Y", and "Can borrow up to ₱Z". */
export function LoanCard({ data }: { data: MemberLoans }) {
  const active = data.loans.filter((l) => l.status === 'RELEASED');
  const balance = active.reduce((s, l) => s + Number(l.balance), 0);
  const next = active
    .filter((l) => l.next)
    .map((l) => l.next!)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const standing: Standing = active.length ? WORST.find((w) => active.some((l) => l.standing === w)) ?? 'UP_TO_DATE' : data.loans.some((l) => l.status === 'PAID') ? 'PAID' : 'NOT_RELEASED';
  return (
    <Card className={`avoid-break border-l-8 p-5 ${STANDING_BORDER[standing]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Loans</div>
        {active.length > 0 && <Badge tone={STANDING[standing].tone}>{STANDING[standing].label}</Badge>}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{active.length ? peso(balance) : '—'}</div>
      <div className="mt-1 text-slate-600">
        {active.length ? (next ? `Next due ${formatDate(next.dueDate)} · ${peso(next.amount)}` : 'Nothing due') : 'No active loan'}
      </div>
      <div className="mt-1 text-slate-700">
        {data.account.isMember ? (
          <>
            Can borrow up to <strong className="tabular-nums text-emerald-700">{peso(data.limit.limit)}</strong>
          </>
        ) : (
          'Only members can borrow'
        )}
      </div>
    </Card>
  );
}

/** The Loans tab: active loans with their schedule and payments, then past loans. */
export function LoansTab({ data, onChanged }: { data: MemberLoans; onChanged: () => void }) {
  const { can, canDo } = useAuth();
  const current = data.loans.filter((l) => l.status === 'RELEASED' || l.status === 'FOR_APPROVAL' || l.status === 'APPROVED');
  const past = data.loans.filter((l) => !current.includes(l));
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-wrap gap-8">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Paid-up share capital</div>
            <div className="text-2xl font-bold tabular-nums">{peso(data.limit.paidUp)}</div>
            {shareCapitalParts(data.limit.shareCapital) && <div className="text-sm text-slate-600">{shareCapitalParts(data.limit.shareCapital)}</div>}
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Can borrow up to</div>
            <div className="text-2xl font-bold tabular-nums text-emerald-700">{data.account.isMember ? peso(data.limit.limit) : '—'}</div>
            <div className="text-sm text-slate-600">
              {data.account.isMember
                ? `${data.limit.percent}% of share capital${Number(data.limit.inUse) > 0 ? `, less ${peso(data.limit.inUse)} on loans` : ''}`
                : 'Only members can borrow'}
            </div>
          </div>
        </div>
        {canDo('LOANS') && data.account.isMember && (
          <LinkButton to={`/loans/new?account=${data.account.id}`} variant="primary">
            + New Loan
          </LinkButton>
        )}
      </Card>
      {can('ADMIN') && data.account.isMember && <OpeningShareCapital data={data} onSaved={onChanged} />}

      {current.length === 0 && <Card className="p-6 text-slate-600">No active loans.</Card>}
      {current.map((loan) => (
        <LoanBlock key={loan.id} loan={loan} />
      ))}

      {past.length > 0 && (
        <Card className="overflow-hidden">
          <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-bold">Past loans</h3>
          <ul className="divide-y divide-slate-100">
            {past.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <Link to={`/loans/${l.id}`} className="font-semibold text-brand-700 underline">
                  {l.number} · {l.typeName} · {peso(l.principal)}
                </Link>
                <span className="flex items-center gap-3 text-slate-600">
                  {l.status === 'PAID' ? `Paid ${formatDate(l.paidOn)}` : formatDate(l.cancelledAt ?? l.decidedAt ?? l.createdAt)}
                  <Badge tone={LOAN_STATUS[l.status].tone} small>
                    {LOAN_STATUS[l.status].label}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function LoanBlock({ loan }: { loan: Loan }) {
  const released = loan.status === 'RELEASED';
  const [open, setOpen] = useState(released && loan.standing === 'OVERDUE');
  return (
    <Card className={`avoid-break border-l-8 p-5 ${STANDING_BORDER[loan.standing]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/loans/${loan.id}`} className="text-xl font-bold text-brand-800 hover:underline">
            {loan.number} · {loan.typeName}
          </Link>
          <div className="text-slate-600">
            {peso(loan.principal)} over {loan.months} months · {peso(loan.monthlyPayment)} a month
            {loan.releaseDate && ` · released ${formatDate(loan.releaseDate)}`}
          </div>
        </div>
        {released ? <Badge tone={STANDING[loan.standing].tone}>{STANDING[loan.standing].label}</Badge> : <Badge tone={LOAN_STATUS[loan.status].tone}>{LOAN_STATUS[loan.status].label}</Badge>}
      </div>
      {released && (
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-lg">
          <span>
            Balance <strong className="tabular-nums">{peso(loan.balance)}</strong>
          </span>
          {loan.next && (
            <span>
              Next due <strong>{formatDate(loan.next.dueDate)}</strong> · <strong className="tabular-nums">{peso(loan.next.amount)}</strong>
            </span>
          )}
          {Number(loan.overdueAmount) > 0 && (
            <span className="font-bold text-red-700">
              Overdue <span className="tabular-nums">{peso(loan.overdueAmount)}</span>
            </span>
          )}
        </div>
      )}
      <button type="button" className="no-print mt-3 font-semibold text-brand-700 underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide schedule and payments' : 'Show schedule and payments'}
      </button>
      <div className={open ? 'mt-3' : 'hidden print:mt-3 print:block'}>
        <ScheduleTable rows={loan.schedule} withStatus={released} />
        {loan.payments.length > 0 && (
          <div className="mt-4">
            <h4 className="font-bold">Payments</h4>
            <ul className="mt-1 divide-y divide-slate-100">
              {loan.payments.map((p) => (
                <li key={p.id} className={`flex flex-wrap justify-between gap-3 py-1.5 ${p.status === 'VOID' ? 'text-slate-400 line-through' : ''}`}>
                  <span>
                    {formatDate(p.date)} · Invoice No. {p.number}
                  </span>
                  <span className="tabular-nums">
                    <strong>{peso(p.amount)}</strong> (interest {peso(p.interest)}, principal {peso(p.principal)}
                    {Number(p.penalty) > 0 && `, penalty ${peso(p.penalty)}`})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Admin: share capital paid before the system, from the paper records. Needs a reason; logged. */
function OpeningShareCapital({ data, onSaved }: { data: MemberLoans; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(data.account.openingShareCapital);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.put(`/loans/member/${data.account.id}/opening-share-capital`, { amount: amount.replace(/[₱,\s]/g, ''), reason });
      setOpen(false);
      setReason('');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="no-print font-semibold text-brand-700 underline" onClick={() => setOpen(true)}>
        Admin: set the share capital paid before the system ({peso(data.account.openingShareCapital)})
      </button>
    );
  }
  return (
    <Card className="no-print p-5">
      <h3 className="text-lg font-bold">Share capital paid before the system</h3>
      <p className="text-slate-600">From the paper share capital ledger. Payments recorded in the system are added to it.</p>
      <div className="mt-3 grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Amount">
          <input className="input text-xl font-bold tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason (required)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. From the share capital ledger" />
        </Field>
      </div>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      <div className="mt-3 flex gap-3">
        <Button variant="primary" onClick={save} disabled={saving || !reason.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
