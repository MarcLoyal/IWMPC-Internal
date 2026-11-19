import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { ApplicationList, MembershipApplications as Data } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { MembershipDecisionModal } from '../components/MembershipDecision';
import { Button, Card, Loading, Notice, PageHeader } from '../components/ui';

const TABS: { key: ApplicationList; label: string }[] = [
  { key: 'FOR_APPROVAL', label: 'For approval' },
  { key: 'APPROVED', label: 'Approved – waiting for fee' },
  { key: 'NOT_APPROVED', label: 'Not approved' },
];

/** Days between a date (YYYY-MM-DD) and today in the Philippines. */
function daysSince(date: string): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000));
}

/** Membership applications by status. Everyone can see the lists; only the Admin records decisions. */
export function MembershipApplications() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = (TABS.find((t) => t.key === params.get('status'))?.key ?? 'FOR_APPROVAL') as ApplicationList;
  const { data, error, loading, reload } = useLoad<Data>(`/accounts/membership-applications?status=${list}`);
  const [deciding, setDeciding] = useState<Data['rows'][number] | null>(null);
  const rows = data?.list === list ? data.rows : [];

  return (
    <>
      <PageHeader
        title="Membership Applications"
        subtitle="Staff submit applications. After the Board meets, the Admin records its decision. The membership fee can be received only after approval."
        back={{ to: '/accounts', label: 'Back to Accounts' }}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={list === t.key}
            onClick={() => setParams(t.key === 'FOR_APPROVAL' ? {} : { status: t.key }, { replace: true })}
            className={`rounded-lg border-2 px-4 py-2.5 text-base font-semibold ${
              list === t.key ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'
            }`}
          >
            {t.label}
            {data && <span className="ml-2 tabular-nums text-slate-500">({data.counts[t.key]})</span>}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="applications" />}
      {data && (
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-slate-500">
              {list === 'FOR_APPROVAL' ? 'No applications are waiting for approval.' : 'None.'}
            </p>
          ) : (
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Applied</th>
                  <th className="th">{list === 'FOR_APPROVAL' ? 'Submitted by' : 'Board decision'}</th>
                  {list === 'FOR_APPROVAL' && can('ADMIN') && <th className="th" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const a = r.application;
                  const waited = a ? daysSince(a.appliedOn) : 0;
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="td">
                        <Link to={`/accounts/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                          {r.fullName}
                        </Link>
                        <div className="text-sm text-slate-600">
                          {r.accountNumber} · {r.area}
                        </div>
                      </td>
                      <td className="td whitespace-nowrap">
                        {a ? formatDate(a.appliedOn) : '—'}
                        {list === 'FOR_APPROVAL' && a && (
                          <div className={`text-sm ${waited > 30 ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>
                            {waited === 0 ? 'today' : waited === 1 ? '1 day waiting' : `${waited} days waiting`}
                          </div>
                        )}
                      </td>
                      <td className="td">
                        {list === 'FOR_APPROVAL' ? (
                          a?.submittedBy
                        ) : a?.decision ? (
                          <>
                            {formatDate(a.boardDecisionDate)}
                            {a.reference && <span className="text-slate-600"> · {a.reference}</span>}
                            {a.reason && <div className="text-sm text-slate-600">Reason: {a.reason}</div>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      {list === 'FOR_APPROVAL' && can('ADMIN') && (
                        <td className="td text-right">
                          <Button variant="primary" onClick={() => setDeciding(r)}>
                            Record Decision
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {deciding && (
        <MembershipDecisionModal
          accountId={deciding.id}
          name={deciding.fullName}
          application={deciding.application}
          onClose={() => setDeciding(null)}
          onSaved={() => {
            setDeciding(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
