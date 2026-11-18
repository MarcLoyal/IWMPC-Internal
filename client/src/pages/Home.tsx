import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatLongDate, peso } from '../lib/format';
import type { HomeSummary } from '../lib/types';
import type { LoanSummary } from '../lib/loans';
import { useLoad } from '../lib/useLoad';
import { Loading, Notice, PageHeader } from '../components/ui';

function SummaryCard({
  to,
  label,
  value,
  detail,
  action,
  tone,
}: {
  to: string;
  label: string;
  value: string;
  detail: React.ReactNode;
  action: string;
  tone?: 'red' | 'green';
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md"
    >
      <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${tone === 'red' ? 'text-red-700' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-2 text-slate-600">{detail}</div>
      <div className="mt-5 font-semibold text-brand-700 group-hover:underline">{action} →</div>
    </Link>
  );
}

export function Home() {
  const { user, canDo } = useAuth();
  const { data, error, loading } = useLoad<HomeSummary>('/reports/home');
  const loans = useLoad<LoanSummary>('/loans/summary').data;
  const n = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count.toLocaleString('en-US')} ${many}`);

  return (
    <>
      <PageHeader title={`Good day, ${user?.name ?? ''}`} subtitle={data ? formatLongDate(data.today) : undefined} />
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading />}
      {data?.invoices?.low && canDo('CASHIER') && (
        <Notice tone="warning" className="mb-5">
          <span className="font-bold">
            Only {data.invoices.remaining.toLocaleString('en-US')} invoice numbers are left (up to {data.invoices.to.toLocaleString('en-US')}).
          </span>{' '}
          Please apply for a new Authority to Print and order new invoice booklets.
        </Notice>
      )}
      {data && (
        <div className="grid gap-5 sm:grid-cols-2">
          <SummaryCard
            to="/cashier/daily-report"
            label="Today's Collections"
            value={peso(data.collections.total)}
            detail={data.collections.count === 1 ? '1 payment today' : `${data.collections.count} payments today`}
            action="Open Daily Collection Report"
          />
          <SummaryCard
            to="/accounts"
            label="Number of Accounts"
            value={data.accounts.total.toLocaleString('en-US')}
            detail={
              <>
                <span className="font-semibold text-emerald-700">{data.accounts.members.toLocaleString('en-US')} members</span>
                {' · '}
                {data.accounts.nonMembers.toLocaleString('en-US')} non-members
              </>
            }
            action="Open Accounts"
          />
          <SummaryCard
            to="/water/overdue"
            label="Overdue Water Bills"
            value={peso(data.overdueWater.total)}
            tone={data.overdueWater.count > 0 ? 'red' : 'green'}
            detail={
              data.overdueWater.count === 0
                ? 'No overdue accounts'
                : data.overdueWater.count === 1
                  ? '1 account is overdue'
                  : `${data.overdueWater.count} accounts are overdue`
            }
            action="Open Overdue List"
          />
        </div>
      )}
      {data && loans && (
        <>
          <h2 className="mb-3 mt-8 text-xl font-bold">Loans</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <SummaryCard to="/loans" label="Active Loans" value={peso(loans.active.balance)} detail={`${n(loans.active.count, 'loan', 'loans')} · balance`} action="Open Loans" />
            <SummaryCard
              to="/loans?view=week"
              label="Loans Due This Week"
              value={peso(loans.dueThisWeek.amount)}
              detail={loans.dueThisWeek.count === 0 ? 'Nothing due in the next 7 days' : `${n(loans.dueThisWeek.count, 'loan', 'loans')} due in the next 7 days`}
              action="Open Due This Week"
            />
            <SummaryCard
              to="/loans?view=overdue"
              label="Overdue Loans"
              value={peso(loans.overdue.amount)}
              tone={loans.overdue.count > 0 ? 'red' : 'green'}
              detail={loans.overdue.count === 0 ? 'No overdue loans' : `${n(loans.overdue.count, 'loan is', 'loans are')} overdue`}
              action="Open Overdue Loans"
            />
            {loans.forApproval !== null && (
              <SummaryCard
                to="/loans?view=approval"
                label="Loans for Approval"
                value={loans.forApproval.toLocaleString('en-US')}
                detail={loans.forApproval === 0 ? 'Nothing waiting' : `${n(loans.forApproval, 'loan is', 'loans are')} waiting for you`}
                action="Open Loans for Approval"
              />
            )}
            {loans.readyToRelease !== null && loans.readyToRelease > 0 && (
              <SummaryCard
                to="/loans?view=release"
                label="Ready to Release"
                value={loans.readyToRelease.toLocaleString('en-US')}
                detail={`${n(loans.readyToRelease, 'approved loan', 'approved loans')} waiting for the cash`}
                action="Open Ready to Release"
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
