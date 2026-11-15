import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, peso } from '../lib/format';
import type { AccountRow } from '../lib/types';
import type { AccountList } from '../lib/types';
import { useDebounced } from '../lib/useLoad';
import { BILL_STATUS, monthShort } from '../lib/water';
import { MonthLegend, MonthStrip } from '../components/MonthStrip';
import { Badge, Button, Card, Field, LinkButton, Loading, Notice, PageHeader } from '../components/ui';

function lastPurchaseText(p: NonNullable<AccountRow['lastPurchase']>): string {
  return `${p.item}${p.moreItems > 0 ? ` + ${p.moreItems} more` : ''}, ${peso(p.amount)}, ${formatDate(p.date)}`;
}

export function Accounts() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const type = params.get('type') ?? 'all';
  const areaId = params.get('areaId') ?? '';
  const water = params.get('water') ?? '';
  const year = params.get('year') ?? '';
  const debouncedSearch = useDebounced(search);

  const query = new URLSearchParams();
  if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());
  if (type !== 'all') query.set('type', type);
  if (areaId) query.set('areaId', areaId);
  if (water) query.set('water', water);
  if (year) query.set('year', year);
  const filters = query.toString();

  // The list is loaded 20 at a time. Changing the search or a dropdown starts again from the top.
  const [data, setData] = useState<AccountList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const ticket = ++latest.current;
      setLoading(true);
      try {
        const page = await api.get<AccountList>(`/accounts?${filters}${filters ? '&' : ''}offset=${offset}`);
        if (ticket !== latest.current) return;
        setData((old) => (offset > 0 && old ? { ...page, rows: [...old.rows, ...page.rows] } : page));
        setError('');
      } catch (err) {
        if (ticket === latest.current) setError(errorMessage(err));
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  function setFilter(key: 'type' | 'areaId' | 'water' | 'year', value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const counts = data?.counts;
  const shown = data?.rows.length ?? 0;
  const remaining = data ? data.total - shown : 0;

  return (
    <>
      <PageHeader title="Accounts">
        {can('ADMIN', 'STAFF') && (
          <LinkButton to="/accounts/new" variant="primary">
            + New Account
          </LinkButton>
        )}
      </PageHeader>

      <Card className="mb-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field label="Search">
            <input className="input py-2" type="search" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </Field>
          <Field label="Type">
            <select className="input py-2" value={type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="all">All{counts ? ` (${counts.type.all})` : ''}</option>
              <option value="members">Members{counts ? ` (${counts.type.members})` : ''}</option>
              <option value="non-members">Non-members{counts ? ` (${counts.type.nonMembers})` : ''}</option>
            </select>
          </Field>
          <Field label="Area">
            <select className="input py-2" value={areaId} onChange={(e) => setFilter('areaId', e.target.value)}>
              <option value="">All{counts ? ` (${counts.allAreas})` : ''}</option>
              {counts?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Water Bill">
            <select className="input py-2" value={water} onChange={(e) => setFilter('water', e.target.value)}>
              <option value="">All</option>
              <option value="paid">Paid</option>
              <option value="due-soon">Due soon</option>
              <option value="overdue">Overdue</option>
            </select>
          </Field>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="accounts" />}

      {data && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <p className="font-semibold text-slate-700" aria-live="polite">
              {data.total === 0
                ? 'No accounts found'
                : shown < data.total
                  ? `Showing ${shown} of ${data.total.toLocaleString('en-US')} accounts`
                  : `Showing ${data.total.toLocaleString('en-US')} ${data.total === 1 ? 'account' : 'accounts'}`}
            </p>
            <MonthLegend />
          </div>

          <Card>
            <table className={`w-full table-fixed transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <colgroup>
                <col />
                <col className="w-[13%]" />
                <col className="w-[22%]" />
                <col className="w-[268px]" />
                <col className="hidden w-[15%] 2xl:table-column" />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th rounded-tl-xl py-1.5">Account</th>
                  <th className="th py-1.5">Area</th>
                  <th className="th py-1.5">Current Water Bill</th>
                  <th className="th rounded-tr-xl py-1.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap">Previous Bills</span>
                      <select
                        aria-label="Months shown"
                        className="w-[118px] shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs font-semibold normal-case tracking-normal text-slate-700"
                        value={year}
                        onChange={(e) => setFilter('year', e.target.value)}
                      >
                        <option value="">Last 12 months</option>
                        {data.years.map((y) => (
                          <option key={y}>{y}</option>
                        ))}
                      </select>
                    </span>
                    <span className="block whitespace-nowrap font-normal normal-case tracking-normal text-slate-500">
                      {monthShort(data.months[0])} {data.months[0].slice(0, 4)} to {monthShort(data.months[11])} {data.months[11].slice(0, 4)}
                    </span>
                  </th>
                  <th className="th hidden py-1.5 2xl:table-cell">Last Rice/LPG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((a) => {
                  const bill = a.water?.current;
                  return (
                    <tr
                      key={a.id}
                      onClick={() => navigate(`/accounts/${a.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/accounts/${a.id}`)}
                      tabIndex={0}
                      role="link"
                      className="cursor-pointer hover:bg-brand-50 focus-visible:bg-brand-50"
                    >
                      <td className="px-4 py-1 align-middle">
                        <div className="flex flex-wrap items-center gap-x-2 leading-tight">
                          <span className="text-base font-bold text-slate-900">{a.fullName}</span>
                          <Badge tone={a.isMember ? 'green' : 'gray'} small>
                            {a.isMember ? 'Member' : 'Non-member'}
                          </Badge>
                        </div>
                        <div className="text-xs leading-tight tabular-nums text-slate-500">
                          {a.accountNumber}
                          {a.memberNumber && <> · Member #{a.memberNumber}</>}
                        </div>
                        {/* On smaller screens the last purchase folds in here, to keep the table from scrolling sideways. */}
                        {a.lastPurchase && (
                          <div className="text-xs leading-tight text-slate-500 2xl:hidden">
                            Last Rice/LPG: {lastPurchaseText(a.lastPurchase)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-1 align-middle text-sm text-slate-700">{a.area}</td>
                      <td className="px-4 py-1 align-middle">
                        {bill ? (
                          <div className="flex flex-wrap items-center gap-x-2">
                            <span className="text-base font-bold tabular-nums text-slate-900">{peso(bill.amount)}</span>
                            <Badge tone={BILL_STATUS[bill.status].tone} small>
                              {BILL_STATUS[bill.status].label}
                            </Badge>
                          </div>
                        ) : (
                          <span className="whitespace-nowrap text-sm text-slate-500">
                            {a.connectionState === 'NONE' ? 'No connection yet' : a.connectionState === 'PENDING' ? 'Not yet installed' : 'No bill yet'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-1 align-middle">
                        {a.water && <MonthStrip months={a.water.months} previousUnpaid={a.water.previousUnpaid} />}
                      </td>
                      <td className="hidden px-4 py-1 align-middle text-sm 2xl:table-cell">
                        {a.lastPurchase ? (
                          <>
                            <span className="block font-semibold tabular-nums">{peso(a.lastPurchase.amount)}</span>
                            <span className="block text-xs text-slate-500">
                              {a.lastPurchase.item}
                              {a.lastPurchase.moreItems > 0 && ` + ${a.lastPurchase.moreItems} more`} · {formatDate(a.lastPurchase.date)}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.rows.length === 0 && (
              <p className="px-6 py-10 text-center text-slate-500">No accounts found. Try a different name or change the dropdowns.</p>
            )}
          </Card>

          {remaining > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
              <Button variant="primary" onClick={() => void load(shown)} disabled={loading}>
                {loading ? 'Loading…' : `Load ${Math.min(20, remaining)} more`}
              </Button>
              <span className="text-slate-600">{remaining.toLocaleString('en-US')} more not shown. Search by name to find one quickly.</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
