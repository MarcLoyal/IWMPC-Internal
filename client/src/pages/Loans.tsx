import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatDate, peso } from '../lib/format';
import { LOAN_STATUS, STANDING, type LoanRow, type LoanStatus, type LoanType } from '../lib/loans';
import { useLoad } from '../lib/useLoad';
import { Badge, Card, Field, LinkButton, Loading, Notice, PageHeader, PrintButton } from '../components/ui';

type View = 'active' | 'approval' | 'release' | 'week' | 'overdue' | 'paid' | 'all';

const VIEWS: { key: View; label: string; status?: LoanStatus; due?: 'WEEK' | 'OVERDUE' }[] = [
  { key: 'active', label: 'Active', status: 'RELEASED' },
  { key: 'week', label: 'Due this week', due: 'WEEK' },
  { key: 'overdue', label: 'Overdue', due: 'OVERDUE' },
  { key: 'approval', label: 'For approval', status: 'FOR_APPROVAL' },
  { key: 'release', label: 'Ready to release', status: 'APPROVED' },
  { key: 'paid', label: 'Paid', status: 'PAID' },
  { key: 'all', label: 'All loans' },
];

interface ListData {
  today: string;
  weekEnd: string;
  loans: LoanRow[];
  loanTypes: LoanType[];
  areas: { id: number; name: string }[];
}

export function Loans() {
  const { canDo } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'active') as View;
  const v = VIEWS.find((x) => x.key === view)!;
  const typeId = params.get('type') ?? '';
  const areaId = params.get('area') ?? '';
  const query = new URLSearchParams();
  if (v.status) query.set('status', v.status);
  if (v.due) query.set('due', v.due);
  if (typeId) query.set('loanTypeId', typeId);
  if (areaId) query.set('areaId', areaId);
  const { data, error, loading } = useLoad<ListData>(`/loans?${query}`);
  const collectors = view === 'week' || view === 'overdue';

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const total = data?.loans.reduce((s, l) => s + Number(view === 'overdue' ? l.overdueAmount : view === 'week' ? l.dueThisWeek : l.balance), 0) ?? 0;

  return (
    <>
      <div className="mb-3 hidden text-center print:block">
        <div className="text-lg font-bold">Inicbulan Waterworks Multi-purpose Cooperative</div>
        <div className="text-base font-semibold uppercase">{view === 'overdue' ? 'Overdue Loans' : view === 'week' ? 'Loans Due This Week' : `Loans · ${v.label}`}</div>
        {data && <div className="text-sm">{view === 'week' ? `${formatDate(data.today)} to ${formatDate(data.weekEnd)}` : `As of ${formatDate(data.today)}`}</div>}
      </div>
      <PageHeader title="Loans" subtitle="Every loan, and the lists for collectors.">
        {collectors && <PrintButton />}
        {canDo('LOANS') && (
          <LinkButton to="/loans/new" variant="primary">
            + New Loan
          </LinkButton>
        )}
      </PageHeader>

      <div className="no-print mb-4 flex flex-wrap gap-2" role="tablist">
        {VIEWS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={view === x.key}
            onClick={() => set('view', x.key === 'active' ? '' : x.key)}
            className={`rounded-lg border-2 px-4 py-2 text-base font-semibold ${view === x.key ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {data && (
        <div className="no-print mb-4 grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Loan type">
            <select className="input" value={typeId} onChange={(e) => set('type', e.target.value)}>
              <option value="">All loan types</option>
              {data.loanTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Area">
            <select className="input" value={areaId} onChange={(e) => set('area', e.target.value)}>
              <option value="">All areas</option>
              {data.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="loans" />}
      {data && data.loans.length === 0 && (
        <Card className="p-8 text-center text-lg text-slate-600">{view === 'overdue' ? 'No loans are overdue.' : view === 'week' ? 'Nothing is due this week.' : 'No loans here yet.'}</Card>
      )}
      {data && data.loans.length > 0 && (
        <p className="mb-2 text-lg">
          <strong>{data.loans.length}</strong> {data.loans.length === 1 ? 'loan' : 'loans'} ·{' '}
          {view === 'overdue' ? 'overdue' : view === 'week' ? 'due this week' : 'balance'} <strong className="tabular-nums">{peso(total)}</strong>
        </p>
      )}
      {data && data.loans.length > 0 && (collectors ? <ByArea loans={data.loans} overdue={view === 'overdue'} /> : <LoanTable loans={data.loans} />)}
    </>
  );
}

function LoanTable({ loans }: { loans: LoanRow[] }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-base">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Member</th>
            <th className="th">Loan</th>
            <th className="th text-right">Balance</th>
            <th className="th">Next due</th>
            <th className="th">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loans.map((l) => (
            <tr key={l.id} className="hover:bg-brand-50/50">
              <td className="td">
                <Link to={`/loans/${l.id}`} className="font-bold text-brand-800 hover:underline">
                  {l.account.fullName}
                </Link>
                <div className="text-sm text-slate-600">{l.account.area}</div>
              </td>
              <td className="td">
                <div className="tabular-nums">{l.number}</div>
                <div className="text-sm text-slate-600">
                  {peso(l.principal)} · {l.months} mo.
                </div>
              </td>
              <td className="td text-right text-lg font-bold tabular-nums">{l.status === 'RELEASED' || l.status === 'PAID' ? peso(l.balance) : '—'}</td>
              <td className="td">
                {l.status === 'RELEASED' && l.next ? (
                  <>
                    <div className="tabular-nums">{formatDate(l.next.dueDate)}</div>
                    <div className="text-sm text-slate-600">{peso(l.next.amount)}</div>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="td">
                {l.status === 'RELEASED' ? <Badge tone={STANDING[l.standing].tone}>{STANDING[l.standing].label}</Badge> : <Badge tone={LOAN_STATUS[l.status].tone}>{LOAN_STATUS[l.status].label}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** For collectors: one block per area, printable. */
function ByArea({ loans, overdue }: { loans: LoanRow[]; overdue: boolean }) {
  const areas = [...new Set(loans.map((l) => l.account.area))];
  return (
    <div className="space-y-5">
      {areas.map((area) => {
        const mine = loans.filter((l) => l.account.area === area);
        const sum = mine.reduce((s, l) => s + Number(overdue ? l.overdueAmount : l.dueThisWeek), 0);
        return (
          <Card key={area} className="avoid-break overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-xl font-bold">{area}</h2>
              <span className="text-lg">
                {mine.length} · <strong className="tabular-nums">{peso(sum)}</strong>
              </span>
            </div>
            <table className="w-full text-base">
              <thead className="border-b border-slate-200 text-left text-sm uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-2">Member</th>
                  <th className="px-4 py-2">{overdue ? 'Late since' : 'Due date'}</th>
                  <th className="px-4 py-2 text-right">{overdue ? 'Overdue' : 'Due'}</th>
                  <th className="px-4 py-2 print:w-48">Collected / signature</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mine.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <Link to={`/loans/${l.id}`} className="font-bold text-brand-800 hover:underline print:text-black print:no-underline">
                        {l.account.fullName}
                      </Link>
                      <div className="text-sm text-slate-600">
                        {l.number}
                        {l.phone && ` · ${l.phone}`}
                      </div>
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {overdue ? formatDate(l.oldestOverdue) : formatDate(l.next?.dueDate)}
                      {overdue && l.overdueCount > 1 && <div className="text-sm text-red-700">{l.overdueCount} installments</div>}
                    </td>
                    <td className={`px-4 py-2 text-right text-lg font-bold tabular-nums ${overdue ? 'text-red-700' : ''}`}>{peso(overdue ? l.overdueAmount : l.dueThisWeek)}</td>
                    <td className="px-4 py-2">
                      <span className="hidden print:block print:h-6 print:border-b print:border-slate-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}
