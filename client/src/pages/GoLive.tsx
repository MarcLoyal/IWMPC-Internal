import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, ROLE } from '../lib/format';
import type { Role } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Badge, Button, Card, Field, LinkButton, Loading, Notice, PageHeader } from '../components/ui';

interface Preview {
  done: { at: string; by: string | null } | null;
  confirmWords: string;
  remove: { key: string; label: string; count: number }[];
  users: { id: number; name: string; email: string; role: Role; status: string; demo: boolean }[];
  notDemo: { user: { id: number; name: string; email: string }; accounts: number; readings: number; payments: number; invoices: number; sales: number; total: number }[];
}

const KEPT = ['Areas', 'Water rates', 'Rice & LPG products and prices', 'Settings (names, fees, invoice booklet)', 'Signatures'];

/** Admin, once ever: remove the demo data on go-live day and start the Audit Log fresh. */
export function GoLive() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useLoad<Preview>('/go-live');
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [alsoOthers, setAlsoOthers] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  // Real logins are kept unless the Admin unticks them; demo logins are always removed.
  useEffect(() => {
    if (data) setKeep(new Set(data.users.filter((u) => !u.demo).map((u) => u.id)));
  }, [data]);

  async function run() {
    setRunning(true);
    setRunError('');
    try {
      await api.post('/go-live', { keepUserIds: [...keep], alsoRemoveOthers: alsoOthers, confirm });
      await reload();
    } catch (err) {
      setRunError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const back = { to: '/settings', label: 'Back to Settings' };
  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;

  if (data.done) {
    return (
      <>
        <PageHeader title="Go-live cleanup" back={back} />
        <Notice tone="success">
          <div className="text-lg font-bold">
            Done on {formatDateTime(data.done.at)}
            {data.done.by ? ` by ${data.done.by}` : ''}.
          </div>
          <div className="font-normal">The demo data was removed and the Audit Log started fresh. This can never be done again, so real records are safe.</div>
        </Notice>
        <LinkButton to="/settings/audit" className="mt-4">
          Open the Audit Log
        </LinkButton>
      </>
    );
  }

  const keptAdmins = data.users.filter((u) => keep.has(u.id) && u.role === 'ADMIN' && u.status === 'ACTIVE');
  // The Admin doing this is always kept, so it must be a real login, not a demo one.
  const meDemo = !!data.users.find((u) => u.id === me?.id)?.demo;
  const ready = !meDemo && confirm.trim().toUpperCase() === data.confirmWords && keptAdmins.length > 0 && (data.notDemo.length === 0 || alsoOthers);

  return (
    <>
      <PageHeader
        title="Go-live cleanup"
        subtitle="Do this once, on go-live day, just before the cooperative starts entering real records."
        back={back}
      />

      {meDemo && (
        <Notice tone="warning" className="mb-5">
          <div className="font-bold">You are logged in with a demo login, which this step removes.</div>
          <div className="font-normal">
            Make a real Admin login in Users and Roles, log out, and log in with it to do the cleanup.
          </div>
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-xl font-bold">Will be removed</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {data.remove.map((r) => (
              <li key={r.key} className="flex justify-between py-2 text-lg">
                <span>{r.label}</span>
                <span className="font-semibold tabular-nums">{r.count.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-slate-600">Account and member numbers start again from the first number. The Audit Log starts fresh, with one entry saying who did this and when.</p>
        </Card>

        <Card className="p-5">
          <h2 className="text-xl font-bold">Always kept</h2>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-lg">
            {KEPT.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <p className="mt-3 text-slate-600">Check the prices and settings afterwards: any sample values you have not changed stay as they are.</p>
        </Card>
      </div>

      <Card className="mt-5 p-5">
        <h2 className="text-xl font-bold">Logins</h2>
        <p className="mt-1 text-slate-600">Tick the logins to keep. Demo logins (@iwmpc.test) are always removed. Make a real login for each person before this step.</p>
        <ul className="mt-3 divide-y divide-slate-100">
          {data.users.map((u) => {
            const self = u.id === me?.id;
            return (
              <li key={u.id} className="py-2">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    disabled={u.demo || self}
                    checked={self || (!u.demo && keep.has(u.id))}
                    onChange={(e) => {
                      const next = new Set(keep);
                      if (e.target.checked) next.add(u.id);
                      else next.delete(u.id);
                      setKeep(next);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-semibold">{u.name}</span> {self && !u.demo && <span className="text-slate-500">(you, always kept)</span>}
                    <span className="block break-words text-slate-600">
                      {u.email} · {ROLE[u.role]}
                      {u.status !== 'ACTIVE' ? ' · deactivated' : ''}
                    </span>
                  </span>
                  {u.demo && (
                    <span className="ml-auto">
                      <Badge tone="gray" small>
                        Demo · removed
                      </Badge>
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {keptAdmins.length === 0 && (
          <Notice tone="warning" className="mt-3">
            Keep at least one active Admin, or nobody could log in. Make a real Admin login in Users and Roles first.
          </Notice>
        )}
      </Card>

      {data.notDemo.length > 0 && (
        <Notice tone="warning" className="mt-5">
          <div className="font-bold">These records were entered by logins that are not demo logins. They may be real:</div>
          <ul className="mt-2 list-disc pl-6 font-normal">
            {data.notDemo.map((r) => (
              <li key={r.user.id}>
                {r.user.name} ({r.user.email}):{' '}
                {[
                  [r.accounts, 'accounts'],
                  [r.readings, 'meter readings'],
                  [r.payments, 'payments'],
                  [r.invoices, 'invoices'],
                  [r.sales, 'sales'],
                ]
                  .filter(([n]) => Number(n) > 0)
                  .map(([n, what]) => `${n} ${what}`)
                  .join(', ')}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-3 font-semibold">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={alsoOthers} onChange={(e) => setAlsoOthers(e.target.checked)} />
            I checked: these were tests too. Remove them with the demo data.
          </label>
          <p className="mt-1 font-normal">If any of them are real, do not continue. Ask for help instead.</p>
        </Notice>
      )}

      <Card className="mt-5 border-red-300 p-5">
        <h2 className="text-xl font-bold text-red-800">Remove the demo data</h2>
        <p className="mt-1 text-slate-700">This cannot be undone, and it can only be done once. After this, the cleanup is locked for good.</p>
        <Field label={`Type ${data.confirmWords} to confirm`} className="mt-4 max-w-sm">
          <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
        {runError && (
          <Notice tone="error" className="mt-4">
            {runError}
          </Notice>
        )}
        <Button variant="danger" className="mt-4 py-3 text-lg" onClick={run} disabled={!ready || running}>
          {running ? 'Removing the demo data…' : 'Remove the demo data and go live'}
        </Button>
      </Card>
    </>
  );
}
