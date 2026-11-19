import { shareCapitalParts } from '../lib/loans';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { peso } from '../lib/format';
import type { LoanType, MemberLoans, Quote } from '../lib/loans';
import type { AccountList } from '../lib/types';
import { useDebounced, useLoad } from '../lib/useLoad';
import { CashBreakdown, Figure, ScheduleTable } from '../components/LoanParts';
import { Badge, Button, Card, Field, Loading, Notice, PageHeader } from '../components/ui';

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

function Step({ n, title, active }: { n: number; title: string; active: boolean }) {
  return (
    <li className={`flex items-center gap-2 ${active ? 'font-bold text-brand-800' : 'text-slate-500'}`}>
      <span className={`flex h-8 w-8 items-center justify-center rounded-full text-base ${active ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-600'}`}>{n}</span>
      {title}
    </li>
  );
}

/** Loan Officer: pick the member, choose the loan, review, submit for approval. */
export function LoanNew() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account');
  const [step, setStep] = useState<1 | 2 | 3>(accountId ? 2 : 1);

  const member = useLoad<MemberLoans>(accountId ? `/loans/member/${accountId}` : null);
  const types = useLoad<{ loanTypes: LoanType[] }>('/loans/types');
  const active = types.data?.loanTypes.filter((t) => t.active) ?? [];

  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState('');
  const [purpose, setPurpose] = useState('');
  const [overReason, setOverReason] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const type = active.find((t) => String(t.id) === typeId) ?? null;
  useEffect(() => {
    if (!typeId && active.length) setTypeId(String(active[0].id));
  }, [active, typeId]);

  const clean = amount.replace(/[₱,\s]/g, '');
  const body = () => ({ accountId: Number(accountId), loanTypeId: Number(typeId), amount: clean, months: Number(months), purpose, overLimitReason: overReason || undefined });

  async function review() {
    setError('');
    if (!AMOUNT.test(clean) || Number(clean) <= 0) return setError('Please enter the loan amount, for example 3000.');
    if (!months) return setError('Please choose the number of months.');
    setBusy(true);
    try {
      const q = await api.post<Quote>('/loans/quote', body());
      setQuote(q);
      setStep(3);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const loan = await api.post<{ id: number }>('/loans', body());
      navigate(`/loans/${loan.id}?new=1`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function pick(id: number | null) {
    const next = new URLSearchParams(params);
    if (id) next.set('account', String(id));
    else next.delete('account');
    setParams(next, { replace: true });
    setQuote(null);
    setStep(id ? 2 : 1);
  }

  const limit = member.data?.limit;
  const overLimit = !!limit && Number(clean) > Number(limit.limit);

  return (
    <>
      <PageHeader title="New Loan" back={{ to: '/loans', label: 'Back to Loans' }} />
      <ol className="mb-5 flex flex-wrap gap-x-8 gap-y-2 text-lg">
        <Step n={1} title="Member" active={step === 1} />
        <Step n={2} title="Loan" active={step === 2} />
        <Step n={3} title="Review" active={step === 3} />
      </ol>

      {step === 1 && <PickMember onPick={pick} />}

      {step > 1 && member.loading && !member.data && <Loading what="the member" />}
      {step > 1 && member.error && <Notice tone="error">{member.error}</Notice>}
      {step > 1 && member.data && limit && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <div className="text-2xl font-bold">{member.data.account.fullName}</div>
            <div className="text-slate-600">
              {member.data.account.accountNumber}
              {member.data.account.memberNumber && ` · Member ${member.data.account.memberNumber}`} · {member.data.account.area}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Share capital</div>
              <div className="text-2xl font-bold tabular-nums">{peso(limit.paidUp)}</div>
              {shareCapitalParts(limit.shareCapital) && <div className="max-w-[260px] text-sm text-slate-600">{shareCapitalParts(limit.shareCapital)}</div>}
            </div>
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Can borrow up to</div>
              <div className="text-3xl font-bold tabular-nums text-emerald-700">{peso(limit.limit)}</div>
              <div className="text-sm text-slate-600">
                {limit.percent}% of share capital{Number(limit.inUse) > 0 ? `, less ${peso(limit.inUse)} on other loans` : ''}
              </div>
            </div>
            <Button onClick={() => pick(null)}>Change member</Button>
          </div>
        </Card>
      )}
      {step > 1 && member.data && !member.data.account.isMember && (
        <Notice tone="error" className="mb-5">
          Only members can borrow. {member.data.account.fullName} is not a member yet.
        </Notice>
      )}

      {step === 2 && member.data?.account.isMember && (
        <Card className="space-y-5 p-6">
          {types.loading && !types.data && <Loading what="loan types" />}
          {types.data && active.length === 0 && <Notice tone="warning">No loan types are set up yet. An Admin can add them in Settings → Loans.</Notice>}
          {active.length > 0 && (
            <>
              <div>
                <div className="label">Loan type</div>
                <div className="flex flex-wrap gap-2">
                  {active.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={typeId === String(t.id)}
                      onClick={() => {
                        setTypeId(String(t.id));
                        setMonths('');
                      }}
                      className={`rounded-lg border-2 px-5 py-3 text-left text-lg font-semibold ${typeId === String(t.id) ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'}`}
                    >
                      {t.name}
                      <span className="block text-sm font-normal text-slate-600">{t.monthlyRate}% a month</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Amount to borrow" hint={limit ? `Up to ${peso(limit.limit)}` : undefined}>
                  <input className="input text-2xl font-bold tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
                </Field>
                <Field label="Number of months">
                  <select className="input text-2xl font-bold" value={months} onChange={(e) => setMonths(e.target.value)}>
                    <option value="">Choose…</option>
                    {type &&
                      Array.from({ length: type.maxMonths - type.minMonths + 1 }, (_, i) => type.minMonths + i).map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? 'month' : 'months'}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label="Purpose (optional)">
                <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. School fees" />
              </Field>
              {overLimit && limit && (
                <Notice tone="error">
                  Maximum for this member is {peso(limit.limit)} ({limit.percent}% of share capital {peso(limit.paidUp)}
                  {Number(limit.inUse) > 0 ? `, less ${peso(limit.inUse)} on their other loans` : ''}).
                  {can('ADMIN') && (
                    <Field label="Admin: reason for going above the limit (required)" className="mt-3">
                      <input className="input" value={overReason} onChange={(e) => setOverReason(e.target.value)} placeholder="e.g. Board resolution no. 12" />
                    </Field>
                  )}
                </Notice>
              )}
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" className="px-8 py-3.5 text-lg" onClick={review} disabled={busy || (overLimit && !(can('ADMIN') && overReason.trim()))}>
                  {busy ? 'Working it out…' : 'Next: Review'}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {step === 3 && quote && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Monthly payment" value={peso(quote.monthlyPayment)} detail={`${quote.months} months`} />
            <Figure label="Total interest" value={peso(quote.totalInterest)} detail={`${quote.monthlyRate}% a month`} />
            <Figure label="Deductions" value={peso(quote.totalDeductions)} />
            <Figure label="Cash to receive" value={peso(quote.netCash)} tone="green" />
          </div>
          <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
            <Card className="p-5">
              <h2 className="mb-2 text-xl font-bold">{quote.loanType.name}</h2>
              <CashBreakdown principal={quote.principal} deductions={quote.deductions} totalDeductions={quote.totalDeductions} netCash={quote.netCash} />
              <p className="mt-3 text-slate-600">
                Total to pay back: <strong className="tabular-nums">{peso(quote.totalToPay)}</strong>. Effective rate {quote.effectiveRate}% a month.
              </p>
              {quote.overLimit && (
                <div className="mt-3">
                  <Badge tone="red">Above the limit · Admin reason given</Badge>
                </div>
              )}
              <p className="mt-3 text-sm text-slate-500">The due dates count from the day the Cashier gives the cash. These assume today.</p>
            </Card>
            <Card className="p-5">
              <h2 className="mb-2 text-xl font-bold">Payment schedule</h2>
              <ScheduleTable rows={quote.schedule} />
            </Card>
          </div>
          {error && (
            <Notice tone="error" className="mt-5">
              {error}
            </Notice>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" className="px-8 py-3.5 text-lg" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </Button>
            <Button className="px-8 py-3.5 text-lg" onClick={() => setStep(2)} disabled={busy}>
              Back
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function PickMember({ onPick }: { onPick: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const list = useLoad<AccountList>(`/accounts?type=members&limit=10&search=${encodeURIComponent(q)}`);
  return (
    <Card className="p-6">
      <Field label="Find the member (name, account or member number)">
        <input className="input text-xl" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus placeholder="Type a name" />
      </Field>
      {list.loading && !list.data && <Loading what="members" />}
      {list.error && <Notice tone="error">{list.error}</Notice>}
      {list.data && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.data.rows.length === 0 && <li className="px-4 py-3 text-slate-600">No member found with that name. Only members can borrow.</li>}
          {list.data.rows.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-50">
                <span>
                  <span className="block text-lg font-bold">{a.fullName}</span>
                  <span className="text-sm text-slate-600">
                    {a.accountNumber}
                    {a.memberNumber && ` · Member ${a.memberNumber}`} · {a.area}
                  </span>
                </span>
                <span className="font-semibold text-brand-700">Choose →</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
