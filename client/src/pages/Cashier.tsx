import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAYMENT_TYPE, peso } from '../lib/format';
import type { AccountList, AccountProfile, AccountRow, BillStatus, Payment, PaymentType, Settings } from '../lib/types';
import { useDebounced, useLoad } from '../lib/useLoad';
import { BILL_STATUS, periodLabel } from '../lib/water';
import { Badge, Button, Card, Detail, Field, LinkButton, Loading, Modal, Notice, PageHeader } from '../components/ui';

const TYPES: PaymentType[] = ['WATER_BILL', 'INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'SHARE_CAPITAL', 'OTHER'];
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

/** What the account owes for water right now: the current bill plus any older unpaid months. */
function waterDue(a: AccountRow): { amount: number; status: BillStatus } | null {
  const w = a.water;
  if (!w?.current) return null;
  const older = Number(w.previousUnpaid);
  const amount = Number(w.current.balance) + older;
  return { amount, status: older > 0 ? 'OVERDUE' : w.current.status };
}

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-3 text-lg font-bold">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-base text-white">{n}</span>
      {children}
    </h2>
  );
}

export function Cashier() {
  const { can } = useAuth();
  const canReceive = can('ADMIN', 'CASHIER');
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account');

  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  // The account list under "Who is paying?": everyone, 20 at a time, narrowed as the cashier types.
  const [list, setList] = useState<AccountList | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const listTicket = useRef(0);
  const term = debounced.trim();
  const loadList = useCallback(
    async (offset: number) => {
      const ticket = ++listTicket.current;
      setListLoading(true);
      try {
        const page = await api.get<AccountList>(`/accounts?search=${encodeURIComponent(term)}&offset=${offset}`);
        if (ticket !== listTicket.current) return;
        setList((old) => (offset > 0 && old ? { ...page, rows: [...old.rows, ...page.rows] } : page));
        setListError('');
      } catch (err) {
        if (ticket === listTicket.current) setListError(errorMessage(err));
      } finally {
        if (ticket === listTicket.current) setListLoading(false);
      }
    },
    [term],
  );
  useEffect(() => {
    if (canReceive && !accountId) void loadList(0);
  }, [canReceive, accountId, loadList]);
  const profile = useLoad<AccountProfile>(accountId ? `/accounts/${accountId}` : null);
  const settings = useLoad<Settings>('/settings');

  const [type, setType] = useState<PaymentType | ''>('');
  // The water bill being paid (chosen with "Pay This"). Empty = the oldest unpaid bill.
  const [waterBillId, setWaterBillId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [orNumber, setOrNumber] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Payment | null>(null);

  function resetForm() {
    setType('');
    setWaterBillId(null);
    setAmount('');
    setOrNumber('');
    setDescription('');
    setError('');
    setConfirming(false);
  }

  // A different account always starts with a clean form.
  useEffect(resetForm, [accountId]);

  function pickAccount(a: AccountRow | null) {
    setSaved(null);
    setSearch('');
    setList(null); // start from the full list again next time
    setParams(a ? { account: String(a.id) } : {}, { replace: true });
  }

  function pickType(next: PaymentType, presetAmount?: string, billId?: number) {
    setType(next);
    setError('');
    // Picking "Water Bill" without choosing a month fills in the oldest unpaid bill.
    const oldest = next === 'WATER_BILL' && !billId ? profile.data?.owed.find((o) => o.type === 'WATER_BILL') : undefined;
    setWaterBillId(billId ?? oldest?.waterBillId ?? null);
    if (oldest) presetAmount = oldest.amount;
    const fee = next === 'MEMBERSHIP_FEE' ? settings.data?.membership_fee : next === 'INSTALLATION_FEE' ? settings.data?.installation_fee : '';
    const value = presetAmount ?? fee ?? '';
    setAmount(Number(value) > 0 ? value : '');
  }

  const cleanAmount = amount.replace(/[₱,\s]/g, '');
  // Only while an account is picked (the last one loaded must not linger after "Change").
  const account = accountId && String(profile.data?.account.id) === accountId ? profile.data?.account : undefined;
  const orMissing = !!type && !orNumber.trim();
  const billBeingPaid = profile.data?.owed.find((o) => o.waterBillId === waterBillId && o.type === 'WATER_BILL');

  function review() {
    if (!type) return setError('Please pick the payment type.');
    if (!AMOUNT.test(cleanAmount) || Number(cleanAmount) <= 0) return setError('Please enter a valid amount, for example 1250.00.');
    if (type === 'OTHER' && !description.trim()) return setError('Please type a short description of what this payment is for.');
    if (!orNumber.trim()) return setError('Please enter the OR number from the receipt booklet.');
    setError('');
    setConfirming(true);
  }

  async function save() {
    if (!account || !type) return;
    setSaving(true);
    try {
      const payment = await api.post<Payment>('/payments', {
        accountId: account.id,
        type,
        amount: cleanAmount,
        orNumber,
        waterBillId: type === 'WATER_BILL' ? waterBillId : null,
        description: type === 'OTHER' ? description : '',
      });
      setSaved(payment);
      resetForm();
    } catch (err) {
      setError(errorMessage(err));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <PageHeader title="Cashier" subtitle="Receive a payment and record it with its OR number.">
      <LinkButton to="/cashier/find">Find by OR Number</LinkButton>
      <LinkButton to="/cashier/daily-report">Daily Collection Report</LinkButton>
    </PageHeader>
  );

  if (!canReceive) {
    return (
      <>
        {header}
        <Notice tone="info">Only the Cashier or an Admin can record payments. You can open the report or find a payment using the buttons above.</Notice>
      </>
    );
  }

  if (saved) {
    return (
      <>
        {header}
        <Card className="max-w-2xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-4xl text-emerald-700">✓</div>
          <h2 className="text-2xl font-bold text-emerald-800">Payment saved</h2>
          <div className="mt-4 text-4xl font-bold tabular-nums">{peso(saved.amount)}</div>
          <p className="mt-3 text-lg">
            {PAYMENT_TYPE[saved.type]}
            {saved.waterBillPeriod && <> for {periodLabel(saved.waterBillPeriod)}</>} from <strong>{saved.accountName}</strong>
          </p>
          <p className="text-lg">
            OR Number <strong className="tabular-nums">{saved.orNumber}</strong>
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => pickAccount(null)}>
              Receive Another Payment
            </Button>
            <LinkButton to={`/accounts/${saved.accountId}`}>View Account</LinkButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="max-w-3xl space-y-5">
        <Card className="p-6">
          <StepTitle n={1}>Who is paying?</StepTitle>
          {!accountId && (
            <>
              <input
                className="input text-lg"
                type="search"
                placeholder="Search name or number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {listError && (
                <Notice tone="error" className="mt-3">
                  {listError}
                </Notice>
              )}
              {!list && listLoading && <Loading what="accounts" />}
              {list && (
                <>
                  <p className="mb-1 mt-4 text-sm font-semibold text-slate-600" aria-live="polite">
                    {list.total === 0
                      ? 'No account found with that name.'
                      : list.rows.length < list.total
                        ? `Showing ${list.rows.length} of ${list.total.toLocaleString('en-US')} accounts. Click the person who is paying.`
                        : `${list.total === 1 ? '1 account' : `${list.total} accounts`}. Click the person who is paying.`}
                  </p>
                  {list.rows.length > 0 && (
                    <ul className={`divide-y divide-slate-100 rounded-lg border border-slate-200 transition-opacity ${listLoading ? 'opacity-60' : ''}`}>
                      {list.rows.map((a) => {
                        const due = waterDue(a);
                        return (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => pickAccount(a)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-brand-50 focus-visible:bg-brand-50"
                            >
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-x-2">
                                  <span className="text-base font-bold">{a.fullName}</span>
                                  <Badge tone={a.isMember ? 'green' : 'gray'} small>
                                    {a.isMember ? 'Member' : 'Non-member'}
                                  </Badge>
                                </span>
                                <span className="block text-xs tabular-nums text-slate-500">
                                  {a.accountNumber}
                                  {a.memberNumber && <> · Member #{a.memberNumber}</>} · {a.area}
                                </span>
                              </span>
                              <span className="shrink-0 text-right">
                                {due ? (
                                  <>
                                    <span className="block text-base font-bold tabular-nums">{peso(due.amount)}</span>
                                    <Badge tone={BILL_STATUS[due.status].tone} small>
                                      {due.status === 'PAID' ? 'Water paid' : `Water · ${BILL_STATUS[due.status].label}`}
                                    </Badge>
                                  </>
                                ) : (
                                  <span className="text-sm text-slate-500">No water bill</span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {list.total > list.rows.length && (
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <Button onClick={() => void loadList(list.rows.length)} disabled={listLoading}>
                        {listLoading ? 'Loading…' : `Load ${Math.min(20, list.total - list.rows.length)} more`}
                      </Button>
                      <span className="text-sm text-slate-600">Or type the name above to find the person quickly.</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {accountId && profile.loading && !profile.data && <Loading />}
          {accountId && profile.error && <Notice tone="error">{profile.error}</Notice>}
          {account && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
              <div>
                <div className="text-xl font-bold">{account.fullName}</div>
                <div className="text-slate-600">
                  {account.accountNumber} · {account.area} · {account.isMember ? `Member ${account.memberNumber}` : 'Non-member'}
                </div>
              </div>
              <Button onClick={() => pickAccount(null)}>Change</Button>
            </div>
          )}
        </Card>

        {account && profile.data && (
          <>
            <Card className="p-6">
              <StepTitle n={2}>What they owe</StepTitle>
              {profile.data.owed.length === 0 ? (
                <p className="text-slate-600">Nothing unpaid on record. You can still receive a payment below.</p>
              ) : (
                <ul className="space-y-2">
                  {profile.data.owed.map((o, i) => (
                    <li
                      key={i}
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                        o.status === 'OVERDUE' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
                      } ${o.waterBillId && o.waterBillId === waterBillId ? 'ring-2 ring-brand-700' : ''}`}
                    >
                      <span className="font-semibold">
                        {o.label}
                        {o.status === 'OVERDUE' && <span className="ml-2 text-red-700">· Overdue</span>}
                      </span>
                      <span className="flex items-center gap-4">
                        <span className="text-xl font-bold tabular-nums">{peso(o.amount)}</span>
                        <Button onClick={() => pickType(o.type, o.amount, o.waterBillId)}>Pay This</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6">
              <StepTitle n={3}>Payment</StepTitle>
              <div className="label">Payment type</div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    onClick={() => pickType(t)}
                    className={`rounded-lg border-2 px-3 py-3 text-lg font-semibold ${
                      type === t ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'
                    }`}
                  >
                    {PAYMENT_TYPE[t]}
                  </button>
                ))}
              </div>

              {type && (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {type === 'OTHER' && (
                    <Field label="What is this payment for?" className="sm:col-span-2">
                      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Certification fee" />
                    </Field>
                  )}
                  <Field
                    label="Amount (₱)"
                    hint={
                      type === 'MEMBERSHIP_FEE'
                        ? 'The membership fee must be paid in full.'
                        : type === 'WATER_BILL'
                          ? billBeingPaid
                            ? `${billBeingPaid.label}. Part payment is allowed.`
                            : 'This account has no unpaid water bill.'
                          : undefined
                    }
                  >
                    <input className="input text-xl font-semibold tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </Field>
                  <Field label="OR Number (required)" hint="From the paper Official Receipt you issued.">
                    <input
                      className={`input text-xl font-semibold tabular-nums ${orMissing ? 'border-amber-500 bg-amber-50' : ''}`}
                      value={orNumber}
                      onChange={(e) => setOrNumber(e.target.value)}
                      autoComplete="off"
                      required
                      aria-required="true"
                    />
                  </Field>
                </div>
              )}

              {error && (
                <Notice tone="error" className="mt-5">
                  {error}
                </Notice>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                {/* The payment cannot go on to the confirm step without an OR number. */}
                <Button variant="primary" className="px-6 py-3 text-lg" onClick={review} disabled={!type || orMissing}>
                  Review Payment
                </Button>
                {orMissing && <span className="font-semibold text-amber-800">Enter the OR number to continue.</span>}
              </div>
            </Card>
          </>
        )}
      </div>

      {confirming && account && type && (
        <Modal
          title="Is this correct?"
          onClose={() => !saving && setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)} disabled={saving}>
                No, Go Back
              </Button>
              <Button variant="success" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Yes, Save Payment'}
              </Button>
            </>
          }
        >
          <dl className="space-y-4">
            <Detail label="Name">
              <span className="text-xl font-bold">{account.fullName}</span> <span className="text-slate-500">({account.accountNumber})</span>
            </Detail>
            <Detail label="Payment type">
              <span className="text-xl font-semibold">{PAYMENT_TYPE[type]}</span>
              {type === 'WATER_BILL' && billBeingPaid && <span className="block text-slate-600">{billBeingPaid.label}</span>}
              {type === 'OTHER' && <span className="block text-slate-600">{description}</span>}
            </Detail>
            <Detail label="Amount">
              <span className="text-3xl font-bold tabular-nums">{peso(cleanAmount)}</span>
            </Detail>
            <Detail label="OR Number">
              <span className="text-xl font-bold tabular-nums">{orNumber.trim().toUpperCase()}</span>
            </Detail>
          </dl>
        </Modal>
      )}
    </>
  );
}
