import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { AccountList } from '../lib/types';
import { useDebounced, useLoad } from '../lib/useLoad';
import { Card, Field, LinkButton, Loading, MemberBadge, Notice, PageHeader } from '../components/ui';

export function Accounts() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const type = params.get('type') ?? 'all';
  const areaId = params.get('areaId') ?? '';
  const debouncedSearch = useDebounced(search);

  const query = new URLSearchParams();
  if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());
  if (type !== 'all') query.set('type', type);
  if (areaId) query.set('areaId', areaId);
  const { data, error, loading } = useLoad<AccountList>(`/accounts?${query}`);

  function setFilter(key: 'type' | 'areaId', value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const counts = data?.counts;

  return (
    <>
      <PageHeader title="Accounts" subtitle="Everyone with a water connection or application, members and non-members.">
        {can('ADMIN', 'STAFF') && (
          <LinkButton to="/accounts/new" variant="primary">
            + New Account
          </LinkButton>
        )}
      </PageHeader>

      <Card className="mb-5 p-5">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
          <Field label="Search">
            <input
              className="input"
              type="search"
              placeholder="Name, account number, or member number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Type">
            <select className="input" value={type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="all">All{counts ? ` (${counts.type.all})` : ''}</option>
              <option value="members">Members{counts ? ` (${counts.type.members})` : ''}</option>
              <option value="non-members">Non-members{counts ? ` (${counts.type.nonMembers})` : ''}</option>
            </select>
          </Field>
          <Field label="Area">
            <select className="input" value={areaId} onChange={(e) => setFilter('areaId', e.target.value)}>
              <option value="">All{counts ? ` (${counts.allAreas})` : ''}</option>
              {counts?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="accounts" />}

      {data && (
        <Card className="overflow-hidden">
          <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Account No.</th>
                  <th className="th">Member No.</th>
                  <th className="th">Area</th>
                  <th className="th">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate(`/accounts/${a.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/accounts/${a.id}`)}
                    tabIndex={0}
                    role="link"
                    className="cursor-pointer hover:bg-brand-50 focus-visible:bg-brand-50"
                  >
                    <td className="td text-lg font-semibold text-slate-900">{a.fullName}</td>
                    <td className="td tabular-nums">{a.accountNumber}</td>
                    <td className="td tabular-nums">{a.memberNumber ?? '—'}</td>
                    <td className="td">{a.area}</td>
                    <td className="td">
                      <MemberBadge isMember={a.isMember} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length === 0 && (
            <p className="px-6 py-12 text-center text-slate-500">
              No accounts found. Try a different name or change the dropdowns.
            </p>
          )}
          {data.rows.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {data.total > data.rows.length
                ? `Showing the first ${data.rows.length} of ${data.total} accounts. Type a name to narrow the list.`
                : `${data.total} ${data.total === 1 ? 'account' : 'accounts'}`}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
