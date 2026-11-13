import { Link, useSearchParams } from 'react-router-dom';
import { formatDate, peso } from '../lib/format';
import type { Area } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { monthShort } from '../lib/water';
import { Badge, Card, Field, Loading, Notice, PageHeader, PrintButton } from '../components/ui';

interface OverdueList {
  today: string;
  threshold: number;
  areas: Area[];
  total: string;
  coop: { name: string; address: string; cdaNo: string };
  rows: {
    accountId: number;
    name: string;
    accountNumber: string;
    area: string;
    phone: string;
    periods: string[];
    months: number;
    amount: string;
    disconnectionCandidate: boolean;
  }[];
}

export function Overdue() {
  const [params, setParams] = useSearchParams();
  const areaId = params.get('areaId') ?? '';
  const only = params.get('show') === 'candidates';
  const { data, error, loading } = useLoad<OverdueList>(`/water/overdue${areaId ? `?areaId=${areaId}` : ''}`);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const rows = (data?.rows ?? []).filter((r) => !only || r.disconnectionCandidate);
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const months = (n: number) => (n === 1 ? '1 month' : `${n} months`);

  return (
    <>
      <div className="mb-4 hidden text-center print:block">
        <img src="/logo.png" alt="" className="mx-auto mb-1 h-16 w-16" />
        <div className="text-lg font-bold">{data?.coop.name}</div>
        {data?.coop.address && <div className="text-sm">{data.coop.address}</div>}
      </div>
      <PageHeader
        title={only ? 'Disconnection Candidates' : 'Overdue Water Bills'}
        subtitle={data ? `As of ${formatDate(data.today)}` : undefined}
        back={{ to: '/water', label: 'Back to Water' }}
      >
        <PrintButton />
      </PageHeader>

      <Card className="no-print mb-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Area">
            <select className="input" value={areaId} onChange={(e) => setFilter('areaId', e.target.value)}>
              <option value="">All areas</option>
              {data?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Show">
            <select className="input" value={only ? 'candidates' : ''} onChange={(e) => setFilter('show', e.target.value)}>
              <option value="">All overdue accounts</option>
              <option value="candidates">Disconnection candidates ({data ? months(data.threshold) : '…'} or more unpaid)</option>
            </select>
          </Field>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading />}
      {data && only && (
        <Notice tone="info" className="mb-4">
          This list is for review only. Nothing is disconnected automatically; disconnecting is done by hand on the account.
        </Notice>
      )}
      {data && (
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-slate-500">{only ? 'No disconnection candidates.' : 'No overdue water bills.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] print:min-w-0">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Area</th>
                    <th className="th">Contact</th>
                    <th className="th">Months unpaid</th>
                    <th className="th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="td">
                        <Link to={`/accounts/${r.accountId}`} className="font-semibold text-brand-700 hover:underline print:text-slate-900">
                          {r.name}
                        </Link>
                        <span className="block text-sm tabular-nums text-slate-500">{r.accountNumber}</span>
                      </td>
                      <td className="td">{r.area}</td>
                      <td className="td tabular-nums">{r.phone || '—'}</td>
                      <td className="td">
                        <span className="font-semibold">{months(r.months)}</span>
                        <span className="ml-2 text-sm text-slate-600">
                          {r.periods.map((p) => `${monthShort(p)} ${p.slice(0, 4)}`).join(', ')}
                        </span>
                        {r.disconnectionCandidate && !only && (
                          <span className="mt-1 block">
                            <Badge tone="red">Disconnection candidate</Badge>
                          </span>
                        )}
                      </td>
                      <td className="td text-right text-lg font-semibold tabular-nums text-red-700">{peso(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                  <tr>
                    <td className="td font-bold" colSpan={4}>
                      Total · {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
                    </td>
                    <td className="td text-right text-lg font-bold tabular-nums">{peso(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
