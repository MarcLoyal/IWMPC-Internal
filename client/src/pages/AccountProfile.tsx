import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CIVIL_STATUS, CONNECTION_STATUS, PAYMENT_TYPE, formatDate, peso } from '../lib/format';
import type { AccountProfile as Profile, Beneficiary, Connection, Payment, PaymentType, Settings } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { BeneficiaryEditor, cleanBeneficiaries } from '../components/BeneficiaryEditor';
import { PaymentDetails, PaymentStatusBadge } from '../components/PaymentDetails';
import { Badge, Button, Card, Detail, Field, LinkButton, Loading, MemberBadge, Modal, Notice, PageHeader, PrintButton } from '../components/ui';

type Tab = 'info' | 'water' | 'transactions';

const CONNECTION_TONE = { PENDING_INSTALLATION: 'yellow', ACTIVE: 'green', DISCONNECTED: 'red' } as const;

export function AccountProfile() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useLoad<Profile>(`/accounts/${id}`);
  const settings = useLoad<Settings>('/settings');
  const [tab, setTab] = useState<Tab>('info');
  const [dialog, setDialog] = useState<null | 'member' | 'connection'>(null);
  const [statusChange, setStatusChange] = useState<Connection | null>(null);
  const [openPayment, setOpenPayment] = useState<Payment | null>(null);
  const [typeFilter, setTypeFilter] = useState<PaymentType | ''>('');

  if (loading && !data) return <Loading what="account" />;
  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;

  const { account, connections, payments, owed, warnings } = data;
  const canEdit = can('ADMIN', 'STAFF');
  const lastPayment = payments.find((p) => p.status === 'ACTIVE');
  const activeConnections = connections.filter((c) => c.status === 'ACTIVE').length;
  const shownPayments = typeFilter ? payments.filter((p) => p.type === typeFilter) : payments;
  const shownTotal = shownPayments.filter((p) => p.status === 'ACTIVE').reduce((sum, p) => sum + Number(p.amount), 0);
  const pending = account.membershipStatus === 'PENDING';

  // On paper, every section prints; on screen, only the chosen tab shows.
  const panel = (name: Tab) => (tab === name ? 'block' : 'hidden print:block');

  return (
    <>
      <div className="mb-4 hidden text-center print:block">
        <img src="/logo.png" alt="" className="mx-auto mb-1 h-16 w-16" />
        <div className="text-lg font-bold">{settings.data?.coop_name}</div>
        {settings.data?.coop_address && <div className="text-sm">{settings.data.coop_address}</div>}
        <div className="mt-1 text-sm font-semibold uppercase tracking-wide">Account Statement · Printed {formatDate(new Date().toISOString())}</div>
      </div>

      <PageHeader
        back={{ to: '/accounts', label: 'Back to Accounts' }}
        title={<span className="text-3xl">{account.fullName}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>
              Account No. <strong className="tabular-nums text-slate-900">{account.accountNumber}</strong>
            </span>
            {account.isMember && (
              <span>
                Member No. <strong className="tabular-nums text-slate-900">{account.memberNumber}</strong>
              </span>
            )}
            <span>
              Area <strong className="text-slate-900">{account.area}</strong>
            </span>
            <MemberBadge isMember={account.isMember} pending={pending} />
          </span>
        }
      >
        <PrintButton />
        {canEdit && <LinkButton to={`/accounts/${account.id}/edit`}>Edit</LinkButton>}
      </PageHeader>

      {warnings.map((w) => (
        <Notice key={w} tone="warning" className="mb-4">
          ⚠ {w}
        </Notice>
      ))}
      {pending && (
        <Notice tone="info" className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>
            Waiting for the membership fee ({peso(settings.data?.membership_fee ?? 0)}). This account becomes a Member once the
            Cashier records the payment.
          </span>
          {can('ADMIN', 'CASHIER') && (
            <LinkButton to={`/cashier?account=${account.id}`} variant="primary">
              Go to Cashier
            </LinkButton>
          )}
        </Notice>
      )}
      {!pending && owed.length > 0 && (
        <Notice tone="warning" className="no-print mb-4">
          Unpaid: {owed.map((o) => `${o.label} (${peso(o.amount)})`).join(', ')}
        </Notice>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="avoid-break p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Water Connections</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">
            {activeConnections} <span className="text-lg font-semibold text-slate-600">active</span>
          </div>
          <div className="mt-1 text-slate-600">
            {connections.length === 0 ? 'No connection yet' : `${connections.length} in total`}
          </div>
        </Card>
        <Card className="avoid-break p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Last Payment</div>
          {lastPayment ? (
            <>
              <div className="mt-1 text-3xl font-bold tabular-nums">{peso(lastPayment.amount)}</div>
              <div className="mt-1 text-slate-600">
                {formatDate(lastPayment.paymentDate)} · {PAYMENT_TYPE[lastPayment.type]} · OR {lastPayment.orNumber}
              </div>
            </>
          ) : (
            <div className="mt-1 text-3xl font-bold text-slate-400">—</div>
          )}
        </Card>
      </div>

      {canEdit && (
        <div className="no-print mb-6 flex flex-wrap gap-3">
          {data.canMakeMember && (
            <Button variant="success" onClick={() => setDialog('member')}>
              Make a Member
            </Button>
          )}
          <Button onClick={() => setDialog('connection')}>+ Add Connection</Button>
        </div>
      )}

      <div className="no-print mb-4 flex gap-1 border-b border-slate-300" role="tablist">
        {(
          [
            ['info', 'Personal Info'],
            ['water', `Water (${connections.length})`],
            ['transactions', `All Transactions (${payments.length})`],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px rounded-t-lg border-b-[3px] px-5 py-3 text-base font-semibold ${
              tab === key ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section className={`${panel('info')} mb-6`}>
        <h2 className="mb-2 hidden text-lg font-bold print:block">Personal Info</h2>
        <Card className="p-6">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            <Detail label="Full name">{account.fullName}</Detail>
            <Detail label="Area">{account.area}</Detail>
            <Detail label="Contact number">{account.phone}</Detail>
            <div className="sm:col-span-2 lg:col-span-3 print:col-span-3">
              <Detail label="Address">{account.address}</Detail>
            </div>
            <Detail label="Birthday">{formatDate(account.birthDate)}</Detail>
            <Detail label="Civil status">{account.civilStatus ? CIVIL_STATUS[account.civilStatus] : ''}</Detail>
            <Detail label="ID">{[account.idType, account.idNumber].filter(Boolean).join(' · ')}</Detail>
            <Detail label="Date registered">{formatDate(account.dateRegistered)}</Detail>
            {account.isMember && <Detail label="Member since">{formatDate(account.memberSince)}</Detail>}
            {account.membershipStatus !== 'NONE' && (
              <div className="sm:col-span-2 lg:col-span-3 print:col-span-3">
                <Detail label="Beneficiaries">
                  {account.beneficiaries.length
                    ? account.beneficiaries.map((b) => (b.relationship ? `${b.name} (${b.relationship})` : b.name)).join(', ')
                    : ''}
                </Detail>
              </div>
            )}
          </dl>
        </Card>
      </section>

      <section className={`${panel('water')} mb-6`}>
        <h2 className="mb-2 hidden text-lg font-bold print:block">Water Connections</h2>
        <Card className="overflow-hidden">
          {connections.length === 0 ? (
            <p className="px-6 py-10 text-center text-slate-500">This account has no water connection yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Connection No.</th>
                    <th className="th">Address</th>
                    <th className="th">Installed</th>
                    <th className="th">Status</th>
                    {canEdit && <th className="th no-print" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {connections.map((c) => (
                    <tr key={c.id}>
                      <td className="td font-semibold tabular-nums">{c.connectionNumber}</td>
                      <td className="td">{c.address || '—'}</td>
                      <td className="td">{formatDate(c.installationDate)}</td>
                      <td className="td">
                        <Badge tone={CONNECTION_TONE[c.status]}>{CONNECTION_STATUS[c.status]}</Badge>
                      </td>
                      {canEdit && (
                        <td className="td no-print text-right">
                          <Button onClick={() => setStatusChange(c)}>
                            {c.status === 'PENDING_INSTALLATION' ? 'Mark as Active' : c.status === 'ACTIVE' ? 'Disconnect' : 'Reconnect'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="no-print mt-3 text-sm text-slate-500">Meter readings and monthly water bills will appear here in the Water phase.</p>
      </section>

      <section className={panel('transactions')}>
        <h2 className="mb-2 hidden text-lg font-bold print:block">All Transactions</h2>
        <Card className="overflow-hidden">
          <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4">
            <Field label="Show">
              <select className="input min-w-[220px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as PaymentType | '')}>
                <option value="">All payment types</option>
                {(Object.keys(PAYMENT_TYPE) as PaymentType[]).map((t) => (
                  <option key={t} value={t}>
                    {PAYMENT_TYPE[t]}
                  </option>
                ))}
              </select>
            </Field>
            <PrintButton />
          </div>
          {shownPayments.length === 0 ? (
            <p className="px-6 py-10 text-center text-slate-500">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Type</th>
                    <th className="th">OR No.</th>
                    <th className="th text-right">Amount</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shownPayments.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setOpenPayment(p)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpenPayment(p)}
                      tabIndex={0}
                      className={`cursor-pointer hover:bg-brand-50 ${p.status === 'VOID' ? 'text-slate-400' : ''}`}
                    >
                      <td className="td whitespace-nowrap">{formatDate(p.paymentDate)}</td>
                      <td className="td">
                        {PAYMENT_TYPE[p.type]}
                        {p.description && <span className="block text-sm text-slate-500">{p.description}</span>}
                      </td>
                      <td className="td font-semibold tabular-nums">{p.orNumber}</td>
                      <td className={`td text-right text-lg font-semibold tabular-nums ${p.status === 'VOID' ? 'line-through' : ''}`}>{peso(p.amount)}</td>
                      <td className="td">
                        <PaymentStatusBadge payment={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                  <tr>
                    <td className="td font-bold" colSpan={3}>
                      Total paid (voided payments not counted)
                    </td>
                    <td className="td text-right text-lg font-bold tabular-nums">{peso(shownTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </section>

      {dialog === 'member' && (
        <MakeMemberDialog
          accountId={account.id}
          name={account.fullName}
          fee={settings.data?.membership_fee ?? '0'}
          initial={account.beneficiaries}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void reload();
          }}
        />
      )}
      {dialog === 'connection' && (
        <AddConnectionDialog
          accountId={account.id}
          defaultAddress={account.address}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setTab('water');
            void reload();
          }}
        />
      )}
      {statusChange && (
        <ConnectionStatusDialog
          connection={statusChange}
          isMember={account.isMember}
          onClose={() => setStatusChange(null)}
          onDone={() => {
            setStatusChange(null);
            void reload();
          }}
        />
      )}
      {openPayment && (
        <PaymentDetails
          payment={{ ...openPayment, accountName: account.fullName, accountNumber: account.accountNumber }}
          onClose={() => setOpenPayment(null)}
          onChanged={(updated) => {
            setOpenPayment(updated);
            void reload();
          }}
        />
      )}
    </>
  );
}

function MakeMemberDialog({
  accountId,
  name,
  fee,
  initial,
  onClose,
  onDone,
}: {
  accountId: number;
  name: string;
  fee: string;
  initial: Beneficiary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>(initial.length ? initial : [{ name: '', relationship: '' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/accounts/${accountId}/make-member`, { beneficiaries: cleanBeneficiaries(beneficiaries) });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Make a Member"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="success" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-lg">
        <strong>{name}</strong> will become a Member after paying the membership fee of <strong>{peso(fee)}</strong> at the Cashier.
      </p>
      <BeneficiaryEditor value={beneficiaries} onChange={setBeneficiaries} />
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}

function AddConnectionDialog({
  accountId,
  defaultAddress,
  onClose,
  onDone,
}: {
  accountId: number;
  defaultAddress: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [connectionNumber, setConnectionNumber] = useState('');
  const [address, setAddress] = useState(defaultAddress);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/accounts/${accountId}/connections`, { connectionNumber, address });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add Connection"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !connectionNumber.trim()}>
            {saving ? 'Saving…' : 'Save Connection'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Connection / meter number">
          <input className="input" value={connectionNumber} onChange={(e) => setConnectionNumber(e.target.value)} autoFocus />
        </Field>
        <Field label="Connection address">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <p className="text-slate-600">
          The connection starts as <strong>Pending Installation</strong>. Mark it as Active after it is installed.
        </p>
      </div>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}

function ConnectionStatusDialog({
  connection,
  isMember,
  onClose,
  onDone,
}: {
  connection: Connection;
  isMember: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const installing = connection.status === 'PENDING_INSTALLATION';
  const disconnecting = connection.status === 'ACTIVE';
  const [installationDate, setInstallationDate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/connections/${connection.id}`, {
        status: disconnecting ? 'DISCONNECTED' : 'ACTIVE',
        ...(installing ? { installationDate } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const title = installing ? 'Mark as Active' : disconnecting ? 'Disconnect' : 'Reconnect';

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant={disconnecting ? 'danger' : 'primary'} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Yes, ${title}`}
          </Button>
        </>
      }
    >
      <p className="text-lg">
        {installing && (
          <>
            Connection <strong>{connection.connectionNumber}</strong> has been installed and is now active?
          </>
        )}
        {disconnecting && (
          <>
            Disconnect connection <strong>{connection.connectionNumber}</strong>?
          </>
        )}
        {connection.status === 'DISCONNECTED' && (
          <>
            Reconnect connection <strong>{connection.connectionNumber}</strong> and make it active again?
          </>
        )}
      </p>
      {installing && (
        <Field label="Installation date" hint="Leave blank to use today." className="mt-4">
          <input className="input" type="date" value={installationDate} onChange={(e) => setInstallationDate(e.target.value)} />
        </Field>
      )}
      {disconnecting && isMember && (
        <Notice tone="warning" className="mt-4">
          This person is a Member. Disconnecting does not change the membership; the profile will only show a warning.
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
