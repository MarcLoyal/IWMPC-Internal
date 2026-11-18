import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, ROLE } from '../lib/format';
import type { Role } from '../lib/types';
import { Badge, Button, Card, Field, Loading, Notice, PageHeader } from '../components/ui';

interface Change {
  field: string;
  label: string;
  before: string;
  after: string;
}

interface Entry {
  id: number;
  at: string;
  user: { id: number; name: string; role: Role } | null;
  action: string;
  category: string;
  summary: string;
  reason: string;
  account: { id: number; name: string } | null;
  changes: Change[];
  isNew: boolean;
}

interface Page {
  entries: Entry[];
  nextBefore: number | null;
  users: { id: number; name: string; status: string }[];
  categories: { key: string; label: string }[];
}

const TONE: Record<string, 'green' | 'yellow' | 'red' | 'gray' | 'blue'> = {
  money: 'green',
  loans: 'blue',
  readings: 'blue',
  accounts: 'blue',
  users: 'yellow',
  access: 'gray',
  settings: 'yellow',
};

const SHORT: Record<string, string> = {
  money: 'Money',
  loans: 'Loans',
  readings: 'Readings',
  accounts: 'Accounts',
  users: 'Users',
  access: 'Login / access',
  settings: 'Settings',
  other: 'Other',
};

// Entries that need a second look are marked in red.
const WARN = new Set(['payment.void', 'invoice.cancel', 'sale.void', 'membership.revoke', 'login.failed', 'access.denied', 'page.blocked', 'reading.correct', 'loan.reject', 'loan.cancel']);

const FILTERS = ['from', 'to', 'userId', 'category', 'accountId'] as const;

/** Admin: who did what and when. View only; entries can never be changed or deleted. */
export function AuditLog() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<Page | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const ticket = useRef(0);

  const query = new URLSearchParams();
  for (const key of FILTERS) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const queryText = query.toString();

  useEffect(() => {
    const mine = ++ticket.current;
    setLoading(true);
    api
      .get<Page>(`/audit?${queryText}`)
      .then((data) => {
        if (mine !== ticket.current) return;
        setPage(data);
        setEntries(data.entries);
        setError('');
      })
      .catch((err) => mine === ticket.current && setError(errorMessage(err)))
      .finally(() => mine === ticket.current && setLoading(false));
  }, [queryText]);

  async function loadMore() {
    if (!page?.nextBefore) return;
    setLoadingMore(true);
    try {
      const more = await api.get<Page>(`/audit?${queryText}${queryText ? '&' : ''}before=${page.nextBefore}`);
      setEntries((list) => [...list, ...more.entries]);
      setPage((p) => (p ? { ...p, nextBefore: more.nextBefore } : more));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function set(key: (typeof FILTERS)[number], value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const accountId = params.get('accountId');
  const accountName = accountId ? entries.find((e) => e.account?.id === Number(accountId))?.account?.name : null;
  const filtered = FILTERS.some((k) => params.get(k));

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Every change, payment, login and blocked attempt: who did it and when. Entries can never be edited or deleted."
        back={{ to: '/settings', label: 'Back to Settings' }}
      />

      <Card className="mb-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From">
            <input type="date" className="input" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <Field label="Person">
            <select className="input" value={params.get('userId') ?? ''} onChange={(e) => set('userId', e.target.value)}>
              <option value="">Everyone</option>
              {page?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.status === 'INACTIVE' ? ' (deactivated)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
              <option value="">Everything</option>
              {page?.categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {(accountId || filtered) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {accountId && (
              <Notice tone="info" className="flex-1">
                Showing only the history of account {accountName ?? `#${accountId}`}.
              </Notice>
            )}
            <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>
          </div>
        )}
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !page && <Loading what="the audit log" />}

      {page && (
        <Card className={`divide-y divide-slate-100 ${loading ? 'opacity-60' : ''}`}>
          {entries.length === 0 && <p className="p-8 text-center text-slate-600">Nothing was recorded for these choices.</p>}
          {entries.map((e) => (
            <Row key={e.id} entry={e} />
          ))}
        </Card>
      )}

      {page?.nextBefore && (
        <div className="mt-4 text-center">
          <Button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show older entries'}
          </Button>
        </div>
      )}
    </>
  );
}

function Row({ entry: e }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const warn = WARN.has(e.action);
  return (
    <div className={`px-5 py-4 ${warn ? 'bg-red-50/40 shadow-[inset_4px_0_0_0_#dc2626]' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-semibold tabular-nums text-slate-700">{formatDateTime(e.at)}</span>
        <Badge tone={warn ? 'red' : (TONE[e.category] ?? 'gray')} small>
          {SHORT[e.category] ?? e.category}
        </Badge>
      </div>
      <p className="mt-1 text-lg text-slate-900">{e.summary}</p>
      {e.reason && (
        <p className="mt-0.5 text-slate-700">
          <span className="font-semibold">Reason:</span> {e.reason}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
        <span>
          By <strong className="text-slate-800">{e.user ? e.user.name : e.action === 'user.access-expire' ? 'the system (end date reached)' : 'Unknown person'}</strong>
          {e.user && ` · ${ROLE[e.user.role]}`}
        </span>
        {e.account && (
          <Link to={`/accounts/${e.account.id}`} className="font-semibold text-brand-700 underline">
            Open account
          </Link>
        )}
        {e.changes.length > 0 && (
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide details' : e.isNew ? 'Show details' : 'Show what changed'}
          </button>
        )}
      </div>
      {open && <Changes changes={e.changes} isNew={e.isNew} />}
    </div>
  );
}

function Changes({ changes, isNew }: { changes: Change[]; isNew: boolean }) {
  return (
    <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50">
      {changes.map((c) => (
        <div key={c.field} className="grid gap-1 px-4 py-2 sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold text-slate-600">{c.label}</dt>
          <dd className="min-w-0 break-words text-slate-900">
            {isNew ? (
              c.after
            ) : (
              <>
                <span className="text-slate-500 line-through decoration-slate-400">{c.before}</span>
                <span className="mx-2 text-slate-400" aria-label="changed to">
                  →
                </span>
                <span className="font-semibold">{c.after}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
