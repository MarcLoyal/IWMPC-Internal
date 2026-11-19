import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CIVIL_STATUS, CONNECTION_STATUS, PAYMENT_TYPE, SEX, ageFrom, formatDate, peso } from '../lib/format';
import type { AccountProfile as Profile, Connection, Payment, PaymentType, Settings } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { BILL_STATUS, RATE_CLASS, periodLabel } from '../lib/water';
import { CustomerCard } from '../components/CustomerCard';
import { PurchasesTab } from '../components/PurchasesTab';
import { PaymentDetails, PaymentStatusBadge } from '../components/PaymentDetails';
import { LoanCard, LoansTab } from '../components/LoansTab';
import type { MemberLoans } from '../lib/loans';
import { MembershipDecisionModal } from '../components/MembershipDecision';
import { Badge, Button, Card, Detail, Field, LinkButton, Loading, MemberBadge, Modal, Notice, PageHeader, PrintButton } from '../components/ui';

type Tab = 'info' | 'water' | 'riceLpg' | 'loans' | 'transactions';

const GRID = 'grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3';
const WIDE = 'sm:col-span-2 lg:col-span-3 print:col-span-3';

const WATER_CARD = {
  PAID: 'border-l-emerald-600',
  UNPAID: 'border-l-slate-300',
  DUE_SOON: 'border-l-amber-400',
  OVERDUE: 'border-l-red-600',
  NONE: 'border-l-slate-200',
} as const;

const CONNECTION_TONE = { PENDING_INSTALLATION: 'yellow', ACTIVE: 'green', DISCONNECTED: 'gray' } as const;

export function AccountProfile() {
  const { id } = useParams();
  const { can, canDo } = useAuth();
  const { data, error, loading, reload } = useLoad<Profile>(`/accounts/${id}`);
  const settings = useLoad<Settings>('/settings');
  const loans = useLoad<MemberLoans>(`/loans/member/${id}`);
  const [tab, setTab] = useState<Tab>('info');
  const [dialog, setDialog] = useState<null | 'connection' | 'decision'>(null);
  const [statusChange, setStatusChange] = useState<Connection | null>(null);
  const [openPayment, setOpenPayment] = useState<Payment | null>(null);
  const [typeFilter, setTypeFilter] = useState<PaymentType | ''>('');

  if (loading && !data) return <Loading what="account" />;
  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;

  const { account, connections, payments, owed, warnings, bills, water, purchases, riceLpg } = data;
  const canEdit = canDo('ACCOUNTS');
  const lastPayment = payments.find((p) => p.status === 'ACTIVE');
  const activeConnections = connections.filter((c) => c.status === 'ACTIVE').length;
  const shownPayments = typeFilter ? payments.filter((p) => p.type === typeFilter) : payments;
  const shownTotal = shownPayments.filter((p) => p.status === 'ACTIVE').reduce((sum, p) => sum + Number(p.amount), 0);
  const pending = account.membershipStatus === 'PENDING';
  const forApproval = account.membershipStatus === 'FOR_APPROVAL';
  const notApproved = account.membershipStatus === 'NOT_APPROVED';
  const applications = data.membershipApplications ?? [];
  const latest = applications[0] ?? null;
  // A non-member with no application in progress, but no active water connection yet: the button
  // stays in its place, greyed out, with the reason.
  const canStartApplication = !account.isMember && (account.membershipStatus === 'NONE' || notApproved);
  const applyBlocked =
    canStartApplication && !data.canMakeMember
      ? `Needs an active water connection first. ${
          connections.some((c) => c.status === 'PENDING_INSTALLATION')
            ? 'The connection is still Pending installation.'
            : connections.some((c) => c.status === 'DISCONNECTED')
              ? 'The connection is Disconnected.'
              : 'This account has no water connection yet.'
        }`
      : '';
  const age = ageFrom(account.birthDate);
  const otherOwed = owed.filter((o) => o.type !== 'WATER_BILL');
  const paid = payments.filter((p) => p.status === 'ACTIVE');
  const feePayment = paid.find((p) => p.type === 'MEMBERSHIP_FEE');
  const capitalPayments = paid.filter((p) => p.type === 'SHARE_CAPITAL');
  const capitalPaid = capitalPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const capitalOrs = capitalPayments.map((p) => p.orNumber).join(', ');

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
            <MemberBadge isMember={account.isMember} status={account.membershipStatus} />
          </span>
        }
      >
        <PrintButton />
        {can('ADMIN') && <LinkButton to={`/settings/audit?accountId=${account.id}`}>History</LinkButton>}
        {canEdit && <LinkButton to={`/accounts/${account.id}/edit`}>Edit</LinkButton>}
      </PageHeader>

      {warnings.map((w) => (
        <Notice key={w} tone="warning" className="mb-4">
          ⚠ {w}
        </Notice>
      ))}
      {forApproval && (
        <Notice tone="warning" className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>Membership application for approval.</strong>
            {latest && ` Applied ${formatDate(latest.appliedOn)}, submitted by ${latest.submittedBy}.`} The Admin records the Board&apos;s
            decision. No membership fee can be received until it is approved.
          </span>
          {can('ADMIN') && (
            <Button variant="primary" onClick={() => setDialog('decision')}>
              Record Board Decision
            </Button>
          )}
        </Notice>
      )}
      {notApproved && (
        <Notice tone="info" className="no-print mb-4">
          <strong>Membership application not approved</strong>
          {latest?.boardDecisionDate && ` by the Board on ${formatDate(latest.boardDecisionDate)}`}.
          {latest?.reason && ` Reason: ${latest.reason}.`} A new application can be submitted.
        </Notice>
      )}
      {pending && (
        <Notice tone="info" className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>
            Approved by the Board{account.boardDecisionDate ? ` on ${formatDate(account.boardDecisionDate)}` : ''}. Waiting for the membership fee ({peso(settings.data?.membership_fee ?? 0)}). This account becomes a Member once the
            Cashier records the payment.
          </span>
          {canDo('CASHIER') && (
            <LinkButton to={`/cashier?account=${account.id}`} variant="primary">
              Go to Cashier
            </LinkButton>
          )}
        </Notice>
      )}
      {!pending && otherOwed.length > 0 && (
        <Notice tone="warning" className="no-print mb-4">
          Unpaid: {otherOwed.map((o) => `${o.label} (${peso(o.amount)})`).join(', ')}
        </Notice>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        <Card className={`avoid-break border-l-8 p-5 ${WATER_CARD[water.hasBills ? water.status : 'NONE']}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Water Bill</div>
            {water.hasBills && <Badge tone={BILL_STATUS[water.status].tone}>{BILL_STATUS[water.status].label}</Badge>}
          </div>
          {water.hasBills ? (
            <>
              <div className="mt-1 text-3xl font-bold tabular-nums">{peso(water.totalDue)}</div>
              <div className="mt-1 text-slate-600">
                {water.status === 'PAID'
                  ? 'Nothing to pay'
                  : `${water.unpaidMonths === 1 ? '1 month' : `${water.unpaidMonths} months`} unpaid · due ${formatDate(water.nextDueDate)}`}
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-3xl font-bold text-slate-400">—</div>
              <div className="mt-1 text-slate-600">
                {activeConnections ? 'No bill yet' : connections.length ? 'No active connection' : 'No connection yet'}
              </div>
            </>
          )}
        </Card>
        {loans.data && (loans.data.account.isMember || loans.data.loans.length > 0) && <LoanCard data={loans.data} />}
        <Card className="avoid-break p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Last Payment</div>
          {lastPayment ? (
            <>
              <div className="mt-1 text-3xl font-bold tabular-nums">{peso(lastPayment.amount)}</div>
              <div className="mt-1 text-slate-600">
                {formatDate(lastPayment.paymentDate)} · {PAYMENT_TYPE[lastPayment.type]} · Invoice No. {lastPayment.orNumber}
              </div>
            </>
          ) : (
            <div className="mt-1 text-3xl font-bold text-slate-400">—</div>
          )}
        </Card>
        <Card className="avoid-break p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Rice &amp; LPG</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{peso(riceLpg.totalThisYear)}</div>
          <div className="mt-1 text-slate-600">Bought in {riceLpg.year}</div>
          {Number(riceLpg.totalThisYear) > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-4 text-slate-700">
              <span>
                Rice <strong className="tabular-nums">{peso(riceLpg.riceThisYear)}</strong>
              </span>
              <span>
                LPG <strong className="tabular-nums">{peso(riceLpg.lpgThisYear)}</strong>
              </span>
              {Number(riceLpg.otherThisYear) > 0 && (
                <span>
                  Other <strong className="tabular-nums">{peso(riceLpg.otherThisYear)}</strong>
                </span>
              )}
            </div>
          )}
          {Number(riceLpg.creditBalance) > 0 && (
            <div className="mt-1">
              <Badge tone="yellow">Unpaid credit: {peso(riceLpg.creditBalance)}</Badge>
            </div>
          )}
        </Card>
      </div>

      {(canEdit || (canDo('LOANS') && account.isMember)) && (
        <div className="no-print mb-6 flex flex-wrap gap-3">
          {canDo('LOANS') && account.isMember && (
            <LinkButton to={`/loans/new?account=${account.id}`} variant="primary">
              + New Loan
            </LinkButton>
          )}
          {canEdit && data.canMakeMember && (
            <LinkButton to={`/accounts/${account.id}/make-member`} variant="success">
              {notApproved ? 'Apply for Membership Again' : 'Apply for Membership'}
            </LinkButton>
          )}
          {canEdit && applyBlocked && (
            <span className="flex flex-wrap items-center gap-3">
              <Button variant="success" disabled>
                Apply for Membership
              </Button>
              <span className="text-slate-600">{applyBlocked}</span>
            </span>
          )}
          {canEdit && <Button onClick={() => setDialog('connection')}>+ Add Connection</Button>}
        </div>
      )}

      <div className="no-print mb-4 flex gap-1 border-b border-slate-300" role="tablist">
        {(
          [
            ['info', 'Personal Info'],
            ['water', `Water (${connections.length})`],
            ['riceLpg', `Rice & LPG (${purchases.length})`],
            ['loans', `Loans (${loans.data?.loans.length ?? 0})`],
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
          <dl className={GRID}>
            <Detail label="Family name">{account.lastName}</Detail>
            <Detail label="Given name">{account.firstName}</Detail>
            <Detail label="Middle name">{account.middleName}</Detail>
            <div className={WIDE}>
              <Detail label="Address">{account.address}</Detail>
            </div>
            <Detail label="Area">{account.area}</Detail>
            <Detail label="Contact number">{account.phone}</Detail>
            <Detail label="TIN">{account.tin}</Detail>
            <Detail label="Birthday">
              {account.birthDate ? `${formatDate(account.birthDate)}${age !== null ? ` (age ${age})` : ''}` : ''}
            </Detail>
            <Detail label="Sex">{account.sex ? SEX[account.sex] : ''}</Detail>
            <Detail label="Civil status">{account.civilStatus ? CIVIL_STATUS[account.civilStatus] : ''}</Detail>
            <Detail label="Religion">{account.religion}</Detail>
            <Detail label="Highest educational attainment">{account.education}</Detail>
            <Detail label="ID">{[account.idType, account.idNumber].filter(Boolean).join(' · ')}</Detail>
            <Detail label="Date registered">{formatDate(account.dateRegistered)}</Detail>
          </dl>

          {account.membershipStatus !== 'NONE' && (
            <>
              <h3 className="mb-4 mt-7 border-t border-slate-200 pt-5 text-lg font-bold">Membership</h3>
              <dl className={GRID}>
                <Detail label="Date of application">{formatDate(account.membershipAppliedOn)}</Detail>
                <Detail label="Member since">{account.isMember ? formatDate(account.memberSince) : 'Not yet a member'}</Detail>
                <Detail label="Member number">{account.memberNumber}</Detail>
                <div className={WIDE}>
                  <Detail label="Purpose/s for membership">{account.membershipPurpose}</Detail>
                </div>
                <Detail label="Subscribed share capital">
                  {account.sharesSubscribed !== null || account.sharesAmount !== null
                    ? `${account.sharesSubscribed ?? '—'} shares · ${account.sharesAmount !== null ? peso(account.sharesAmount) : '—'}`
                    : ''}
                </Detail>
                <Detail label="Share capital paid">{capitalPaid > 0 ? `${peso(capitalPaid)} · Invoice No. ${capitalOrs}` : 'None yet'}</Detail>
                <Detail label="Membership fee">{feePayment ? `${peso(feePayment.amount)} · Invoice No. ${feePayment.orNumber}` : 'Not yet paid'}</Detail>
                <div className={WIDE}>
                  <Detail label="Beneficiaries">
                    {account.beneficiaries.map((b) => (b.relationship ? `${b.name} (${b.relationship})` : b.name)).join(', ')}
                  </Detail>
                </div>
                <Detail label="Registered name of household water meter">{account.meterRegisteredName}</Detail>
                <Detail label="Attended PMES">{account.pmesAttended === null ? 'Not yet recorded' : account.pmesAttended ? 'Yes' : 'No'}</Detail>
                <Detail label="Board decision">
                  {account.boardDecision
                    ? `${account.boardDecision === 'APPROVED' ? 'Approved' : 'Not approved'}${account.boardDecisionDate ? ` · ${formatDate(account.boardDecisionDate)}` : ''}`
                    : 'Waiting for approval'}
                </Detail>
              </dl>
              {applications.length > 0 && (
                <div className="mt-6">
                  <h4 className="mb-2 font-bold">Application history</h4>
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {applications.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                        <span>
                          Applied <strong>{formatDate(a.appliedOn)}</strong> <span className="text-slate-600">· submitted by {a.submittedBy}</span>
                          {a.decision && (
                            <span className="block text-sm text-slate-600">
                              Board decision {formatDate(a.boardDecisionDate)}
                              {a.reference && ` · ${a.reference}`} · recorded by {a.decidedBy}
                              {a.reason && ` · Reason: ${a.reason}`}
                            </span>
                          )}
                        </span>
                        {a.decision === 'APPROVED' ? (
                          <Badge tone="green">Approved</Badge>
                        ) : a.decision === 'DISAPPROVED' ? (
                          <Badge tone="gray">Not approved</Badge>
                        ) : (
                          <Badge tone="yellow">For approval</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      <section className={`${panel('water')} mb-6`}>
        <h2 className="mb-2 hidden text-lg font-bold print:block">Water Connections</h2>
        <Card className="overflow-hidden">
          {connections.length === 0 ? (
            <p className="px-6 py-10 text-center text-slate-500">This account has no water connection yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] print:min-w-0">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Water Meter</th>
                    <th className="th">Address</th>
                    <th className="th">Applied</th>
                    <th className="th">Installed</th>
                    <th className="th">Status</th>
                    {canEdit && <th className="th no-print" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {connections.map((c) => (
                    <tr key={c.id}>
                      <td className="td">
                        <span className="font-semibold tabular-nums">
                          {c.meterSerial ? `${c.meterName ? `${c.meterName} ` : ''}# ${c.meterSerial}` : c.meterName || 'No serial number yet'}
                        </span>
                        <span className="block text-sm text-slate-500">{RATE_CLASS[c.rateClass] ?? c.rateClass}</span>
                      </td>
                      <td className="td">
                        {c.address || '—'}
                        {c.remarks && <span className="block text-sm text-slate-500">Remarks: {c.remarks}</span>}
                      </td>
                      <td className="td whitespace-nowrap">{formatDate(c.applicationDate)}</td>
                      <td className="td whitespace-nowrap">{formatDate(c.installationDate)}</td>
                      <td className="td">
                        <Badge tone={CONNECTION_TONE[c.status]}>{CONNECTION_STATUS[c.status]}</Badge>
                        {c.status === 'PENDING_INSTALLATION' && Number(settings.data?.installation_fee ?? 0) > 0 && (
                          <span className={`block text-sm ${c.installationFeePaid ? 'text-emerald-700' : 'text-amber-800'}`}>
                            {c.installationFeePaid ? 'Installation fee paid' : 'Installation fee not yet paid'}
                          </span>
                        )}
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
        <div className="mt-5 space-y-5">
          {connections
            .filter((c) => c.status !== 'PENDING_INSTALLATION')
            .map((c) => (
              <CustomerCard key={c.id} name={account.fullName} connection={c} bills={bills.filter((b) => b.connectionId === c.id)} />
            ))}
        </div>
      </section>

      <section className={`${panel('riceLpg')} mb-6`}>
        <h2 className="mb-2 hidden text-lg font-bold print:block">Rice &amp; LPG</h2>
        <PurchasesTab purchases={purchases} />
      </section>

      <section className={`${panel('loans')} mb-6`}>
        <h2 className="mb-2 hidden text-lg font-bold print:block">Loans</h2>
        {loans.error && <Notice tone="error">{loans.error}</Notice>}
        {loans.data && <LoansTab data={loans.data} onChanged={() => void loans.reload()} />}
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
                    <th className="th">Invoice No.</th>
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
                        {p.items?.map((item, i) => (
                          <span key={i} className="block text-sm text-slate-500">
                            {item.productName}, {item.quantity} × {item.unitLabel}
                          </span>
                        ))}
                        {p.waterBillPeriod && <span className="block text-sm text-slate-500">{periodLabel(p.waterBillPeriod)}</span>}
                        {!p.items?.length && p.description && <span className="block text-sm text-slate-500">{p.description}</span>}
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

      {dialog === 'decision' && (
        <MembershipDecisionModal
          accountId={account.id}
          name={account.fullName}
          application={latest}
          onClose={() => setDialog(null)}
          onSaved={() => {
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
          installationFee={Number(settings.data?.installation_fee ?? 0)}
          isAdmin={can('ADMIN')}
          canReceive={canDo('CASHIER')}
          accountId={account.id}
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

/** The water connection application (Form No. 2-A). */
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
  const [form, setForm] = useState({
    applicationDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
    rateClass: 'RESIDENTIAL',
    meterSerial: '',
    meterName: '',
    address: defaultAddress,
    remarks: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/accounts/${accountId}/connections`, form);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add Connection"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Connection'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of application">
          <input className="input" type="date" value={form.applicationDate} onChange={set('applicationDate')} />
        </Field>
        <Field label="Water meter brand">
          <input className="input" value={form.meterName} onChange={set('meterName')} placeholder="e.g. Meco" />
        </Field>
        <Field label="Water meter serial number">
          <input className="input" value={form.meterSerial} onChange={set('meterSerial')} autoFocus />
        </Field>
        <Field label="Rate" className="sm:col-span-2">
          <select className="input" value={form.rateClass} onChange={set('rateClass')}>
            <option value="RESIDENTIAL">{RATE_CLASS.RESIDENTIAL}</option>
            <option value="COMMERCIAL">{RATE_CLASS.COMMERCIAL}</option>
          </select>
        </Field>
        <Field label="Connection address" className="sm:col-span-2">
          <input className="input" value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Remarks (Puna)" className="sm:col-span-2">
          <textarea className="input" rows={2} value={form.remarks} onChange={set('remarks')} />
        </Field>
        <p className="text-slate-600 sm:col-span-2">
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
  installationFee,
  isAdmin,
  canReceive,
  accountId,
  onClose,
  onDone,
}: {
  connection: Connection;
  isMember: boolean;
  installationFee: number;
  isAdmin: boolean;
  canReceive: boolean;
  accountId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const installing = connection.status === 'PENDING_INSTALLATION';
  // The installation fee must be received before a new connection can be Active (checked on the server).
  const feeMissing = installing && installationFee > 0 && !connection.installationFeePaid;
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const disconnecting = connection.status === 'ACTIVE';
  const [installationDate, setInstallationDate] = useState('');
  const [initialReading, setInitialReading] = useState('0');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/connections/${connection.id}`, {
        status: disconnecting ? 'DISCONNECTED' : 'ACTIVE',
        ...(installing ? { installationDate, initialReading: initialReading.trim() === '' ? 0 : Number(initialReading) } : {}),
        ...(feeMissing && override ? { feeNotPaidReason: reason.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const which = connection.meterSerial ? <>the connection with water meter <strong>{connection.meterSerial}</strong></> : <>this connection</>;
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
          {feeMissing && !override ? (
            canReceive && (
              <LinkButton to={`/cashier?account=${accountId}`} variant="primary">
                Go to Cashier
              </LinkButton>
            )
          ) : (
            <Button variant={disconnecting ? 'danger' : 'primary'} onClick={save} disabled={saving || (feeMissing && override && !reason.trim())}>
              {saving ? 'Saving…' : `Yes, ${title}`}
            </Button>
          )}
        </>
      }
    >
      <p className="text-lg">
        {installing && (
          <>
            Has {which} been installed, and is it now active?
          </>
        )}
        {disconnecting && (
          <>
            Disconnect {which}?
          </>
        )}
        {connection.status === 'DISCONNECTED' && (
          <>
            Reconnect {which} and make it active again?
          </>
        )}
      </p>
      {feeMissing && (
        <Notice tone="warning" className="mt-4">
          <strong>The installation fee ({peso(installationFee)}) has not been paid for this connection yet.</strong> Receive it at the
          Cashier first. Then this connection can be marked Active.
        </Notice>
      )}
      {feeMissing && isAdmin && (
        <div className="mt-4 rounded-lg border border-slate-300 p-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span>
              <span className="font-semibold">Admin: mark Active without the fee in the system</span>
              <span className="block text-sm text-slate-600">For connections installed before the system was used (paid on paper), or a waived fee.</span>
            </span>
          </label>
          {override && (
            <Field label="Reason (required)" className="mt-3">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Installed 2019, paid on paper receipt no. 1234" autoFocus />
            </Field>
          )}
        </div>
      )}
      {installing && (!feeMissing || override) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Installation date" hint="Leave blank to use today.">
            <input className="input" type="date" value={installationDate} onChange={(e) => setInstallationDate(e.target.value)} />
          </Field>
          <Field label="Meter reading when installed" hint="The first bill counts from this number.">
            <input className="input tabular-nums" inputMode="numeric" value={initialReading} onChange={(e) => setInitialReading(e.target.value)} />
          </Field>
        </div>
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
