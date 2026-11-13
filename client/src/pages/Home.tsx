import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatLongDate, peso } from '../lib/format';
import type { HomeSummary } from '../lib/types';
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

function ComingCard({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
      <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-400">Coming soon</div>
      <div className="mt-2 text-slate-500">This will be added in {phase}.</div>
    </div>
  );
}

export function Home() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad<HomeSummary>('/reports/home');

  return (
    <>
      <PageHeader title={`Good day, ${user?.name ?? ''}`} subtitle={data ? formatLongDate(data.today) : undefined} />
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading />}
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
          <ComingCard label="Loans Due This Week" phase="the Loans phase" />
        </div>
      )}
    </>
  );
}
