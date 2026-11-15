import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAYMENT_TYPE, peso } from '../lib/format';
import type { AccountList, AccountProfile, AccountRow, BillStatus, Payment, PaymentType, Product, SaleLine, Settings } from '../lib/types';
import { SaleBuilder, cartTotal, lineAmount, type CartItem } from '../components/SaleBuilder';
import { useDebounced, useLoad } from '../lib/useLoad';
import { BILL_STATUS, periodLabel } from '../lib/water';
import { Badge, Button, Card, Detail, Field, LinkButton, Loading, Modal, Notice, PageHeader } from '../components/ui';

const TYPES: PaymentType[] = ['WATER_BILL', 'RICE_LPG', 'INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'SHARE_CAPITAL', 'OTHER'];

/** What the "saved" screen shows after a payment or a sale. */
interface Saved {
  title: string;
  amount: string;
  what: string;
  name: string;
  orNumber: string | null;
  accountId: number | null;
  items: SaleLine[];
}
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
  // A buyer with no account. Only Rice & LPG can be sold to a walk-in.
  const walkIn = !accountId && params.get('walkin') === '1';

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
    if (canReceive && !accountId && !walkIn) void loadList(0);
  }, [canReceive, accountId, walkIn, loadList]);
  const profile = useLoad<AccountProfile>(accountId ? `/accounts/${accountId}` : null);
  const settings = useLoad<Settings>('/settings');
  const products = useLoad<{ products: Product[] }>('/products');

  const [type, setType] = useState<PaymentType | ''>('');
  // The water bill being paid (chosen with "Pay This"). Empty = the oldest unpaid bill.
  const [waterBillId, setWaterBillId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [orNumber, setOrNumber] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  // Rice & LPG: the items in the sale being made, or the earlier credit sale being paid.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleId, setSaleId] = useState<number | null>(null);
  const [credit, setCredit] = useState(false);
  const [walkInName, setWalkInName] = useState('');

  function resetForm() {
    setType(walkIn ? 'RICE_LPG' : '');
    setCart([]);
    setSaleId(null);
    setCredit(false);
    setWaterBillId(null);
    setAmount('');
    setOrNumber('');
    setDescription('');
    setError('');
    setConfirming(false);
  }

  // A different account always starts with a clean form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetForm, [accountId, walkIn]);

  function pickAccount(a: AccountRow | null) {
    setSaved(null);
    setSearch('');
    setList(null); // start from the full list again next time
    setWalkInName('');
    setParams(a ? { account: String(a.id) } : {}, { replace: true });
  }

  function startWalkIn() {
    setSaved(null);
    setWalkInName('');
    setParams({ walkin: '1' }, { replace: true });
  }

  function pickType(next: PaymentType, presetAmount?: string, billId?: number, creditSaleId?: number) {
    setType(next);
    setError('');
    setSaleId(creditSaleId ?? null);
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
  const isMember = account?.isMember ?? false;
  // A new Rice & LPG sale (as opposed to paying an earlier credit sale).
  const isSale = type === 'RICE_LPG' && !saleId;
  const creditAllowed = settings.data?.allow_credit === 'true' && !!account;
  const onCredit = isSale && credit && creditAllowed;
  const total = cartTotal(cart);
  const orMissing = !!type && !orNumber.trim() && !onCredit;
  // The membership fee is paid in full in one payment: less (or more) than the fee cannot go on.
  const fee = Number(settings.data?.membership_fee ?? 0);
  const typed = AMOUNT.test(cleanAmount) ? Number(cleanAmount) : null;
  const feeProblem =
    type !== 'MEMBERSHIP_FEE' || typed === null || Math.round(typed * 100) === Math.round(fee * 100)
      ? null
      : typed < fee
        ? `This is ${peso(fee - typed)} short. The membership fee is ${peso(fee)} and must be paid in full.`
        : `This is more than the membership fee of ${peso(fee)}. Please enter exactly ${peso(fee)}.`;
  const creditBeingPaid = profile.data?.owed.find((o) => o.saleId && o.saleId === saleId);
  const buyerName = account?.fullName ?? (walkInName.trim() || 'Walk-in customer');
  const billBeingPaid = profile.data?.owed.find((o) => o.waterBillId === waterBillId && o.type === 'WATER_BILL');

  function review() {
    if (!type) return setError('Please pick the payment type.');
    if (isSale) {
      if (cart.length === 0) return setError('Please add at least one item to the sale.');
      if (!onCredit && !orNumber.trim()) return setError('Please enter the OR number from the receipt booklet.');
      setError('');
      return setConfirming(true);
    }
    if (!AMOUNT.test(cleanAmount) || Number(cleanAmount) <= 0) return setError('Please enter a valid amount, for example 1250.00.');
    if (feeProblem) return setError(feeProblem);
    if (type === 'OTHER' && !description.trim()) return setError('Please type a short description of what this payment is for.');
    if (!orNumber.trim()) return setError('Please enter the OR number from the receipt booklet.');
    setError('');
    setConfirming(true);
  }

  async function save() {
    if (!type || (!account && !walkIn)) return;
    setSaving(true);
    try {
      if (isSale) {
        const sale = await api.post<{ total: string; isCredit: boolean; items: SaleLine[]; payment: Payment | null }>('/sales', {
          accountId: account?.id ?? null,
          walkInName,
          items: cart.map((item) => ({ unitId: item.unitId, quantity: item.quantity })),
          orNumber: onCredit ? '' : orNumber,
          credit: onCredit,
        });
        setSaved({
          title: sale.isCredit ? 'Credit sale saved' : 'Sale saved',
          amount: sale.total,
          what: sale.isCredit ? 'Rice & LPG on credit, to be paid later by' : 'Rice & LPG sold to',
          name: buyerName,
          orNumber: sale.payment?.orNumber ?? null,
          accountId: account?.id ?? null,
          items: sale.items,
        });
      } else if (account) {
        const payment = await api.post<Payment>('/payments', {
          accountId: account.id,
          type,
          amount: cleanAmount,
          orNumber,
          waterBillId: type === 'WATER_BILL' ? waterBillId : null,
          saleId: type === 'RICE_LPG' ? saleId : null,
          description: type === 'OTHER' ? description : '',
        });
        setSaved({
          title: 'Payment saved',
          amount: payment.amount,
          what: `${PAYMENT_TYPE[payment.type]}${payment.waterBillPeriod ? ` for ${periodLabel(payment.waterBillPeriod)}` : ''}${payment.saleId ? ' (payment for an earlier credit sale)' : ''} from`,
          name: payment.accountName ?? account.fullName,
          orNumber: payment.orNumber,
          accountId: account.id,
          items: [],
        });
      }
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
      <LinkButton to="/cashier/sales-report">Rice &amp; LPG Sales</LinkButton>
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
          <h2 className="text-2xl font-bold text-emerald-800">{saved.title}</h2>
          <div className="mt-4 text-4xl font-bold tabular-nums">{peso(saved.amount)}</div>
          <p className="mt-3 text-lg">
            {saved.what} <strong>{saved.name}</strong>
          </p>
          {saved.items.length > 0 && (
            <ul className="mx-auto mt-3 max-w-md divide-y divide-slate-100 rounded-lg border border-slate-200 text-left">
              {saved.items.map((item, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2">
                  <span>
                    <strong>{item.productName}</strong> · {item.quantity} × {item.unitLabel}
                  </span>
                  <span className="font-semibold tabular-nums">{peso(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-lg">
            {saved.orNumber ? (
              <>
                OR Number <strong className="tabular-nums">{saved.orNumber}</strong>
              </>
            ) : (
              'No OR number yet. It is entered when the credit is paid.'
            )}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => pickAccount(null)}>
              Receive Another Payment
            </Button>
            {saved.accountId && <LinkButton to={`/accounts/${saved.accountId}`}>View Account</LinkButton>}
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
          {walkIn && (
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
              <div className="min-w-[240px] flex-1">
                <div className="text-xl font-bold">Walk-in customer</div>
                <div className="mb-2 text-slate-600">No account. Only Rice &amp; LPG can be sold.</div>
                <Field label="Name (optional)">
                  <input className="input" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="e.g. Aling Nena" />
                </Field>
              </div>
              <Button onClick={() => pickAccount(null)}>Change</Button>
            </div>
          )}
          {!accountId && !walkIn && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Button onClick={startWalkIn}>Walk-in customer (no account)</Button>
                <span className="text-sm text-slate-600">For a Rice &amp; LPG buyer who has no account. Otherwise pick the person below.</span>
              </div>
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

        {((account && profile.data) || walkIn) && (
          <>
            {account && profile.data && (
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
                      } ${(o.waterBillId && o.waterBillId === waterBillId) || (o.saleId && o.saleId === saleId) ? 'ring-2 ring-brand-700' : ''}`}
                    >
                      <span className="font-semibold">
                        {o.label}
                        {o.status === 'OVERDUE' && <span className="ml-2 text-red-700">· Overdue</span>}
                      </span>
                      <span className="flex items-center gap-4">
                        <span className="text-xl font-bold tabular-nums">{peso(o.amount)}</span>
                        <Button onClick={() => pickType(o.type, o.amount, o.waterBillId, o.saleId)}>Pay This</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            )}

            <Card className="p-6">
              <StepTitle n={walkIn ? 2 : 3}>{walkIn ? 'Rice & LPG sale' : 'Payment'}</StepTitle>
              {!walkIn && (
                <>
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
                </>
              )}

              {isSale && (
                <div className={walkIn ? '' : 'mt-5'}>
                  {products.loading && !products.data ? (
                    <Loading what="products" />
                  ) : (
                    <SaleBuilder products={products.data?.products ?? []} isMember={isMember} items={cart} onChange={setCart} />
                  )}
                  {cart.length > 0 && (
                    <div className="mt-5 grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-2">
                      {creditAllowed && (
                        <label className="flex items-start gap-3 sm:col-span-2">
                          <input type="checkbox" className="mt-1 h-5 w-5" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
                          <span>
                            <span className="font-semibold">Sell on credit (utang)</span>
                            <span className="block text-sm text-slate-600">
                              No payment now and no OR number yet. The amount goes to what {account?.fullName} owes.
                            </span>
                          </span>
                        </label>
                      )}
                      {!onCredit && (
                        <Field label="OR Number (required)" hint="One OR number for the whole sale.">
                          <input
                            className={`input text-xl font-semibold tabular-nums ${orMissing ? 'border-amber-500 bg-amber-50' : ''}`}
                            value={orNumber}
                            onChange={(e) => setOrNumber(e.target.value)}
                            autoComplete="off"
                            required
                            aria-required="true"
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              )}

              {type && !isSale && (
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
                          : type === 'RICE_LPG' && creditBeingPaid
                            ? `${creditBeingPaid.label}. Part payment is allowed.`
                            : undefined
                    }
                  >
                    <input
                      className={`input text-xl font-semibold tabular-nums ${feeProblem ? 'border-red-500 bg-red-50' : ''}`}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      aria-invalid={!!feeProblem}
                    />
                    {feeProblem && <span className="mt-1 block font-semibold text-red-700">{feeProblem}</span>}
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
                <Button variant="primary" className="px-6 py-3 text-lg" onClick={review} disabled={!type || (isSale ? cart.length === 0 || orMissing : orMissing || !!feeProblem)}>
                  {isSale ? 'Review Sale' : 'Review Payment'}
                </Button>
                {isSale && cart.length === 0 && <span className="font-semibold text-slate-600">Add at least one item to continue.</span>}
                {feeProblem ? (
                  <span className="font-semibold text-red-700">The full membership fee is needed to continue.</span>
                ) : (
                  orMissing && (!isSale || cart.length > 0) && <span className="font-semibold text-amber-800">Enter the OR number to continue.</span>
                )}
              </div>
            </Card>
          </>
        )}
      </div>

      {confirming && (account || walkIn) && type && (
        <Modal
          title="Is this correct?"
          onClose={() => !saving && setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)} disabled={saving}>
                No, Go Back
              </Button>
              <Button variant="success" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : isSale ? 'Yes, Save Sale' : 'Yes, Save Payment'}
              </Button>
            </>
          }
        >
          <dl className="space-y-4">
            <Detail label="Name">
              <span className="text-xl font-bold">{buyerName}</span>{' '}
              <span className="text-slate-500">{account ? `(${account.accountNumber})` : '(no account)'}</span>
            </Detail>
            <Detail label="Payment type">
              <span className="text-xl font-semibold">{PAYMENT_TYPE[type]}</span>
              {type === 'WATER_BILL' && billBeingPaid && <span className="block text-slate-600">{billBeingPaid.label}</span>}
              {type === 'OTHER' && <span className="block text-slate-600">{description}</span>}
              {type === 'RICE_LPG' && creditBeingPaid && <span className="block text-slate-600">{creditBeingPaid.label}</span>}
              {onCredit && <span className="block font-semibold text-amber-800">On credit (utang): not paid today</span>}
            </Detail>
            {isSale && (
              <Detail label="Items">
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {cart.map((item, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <span>
                        <strong>{item.productName}</strong> · {item.quantity} × {item.unitLabel}
                      </span>
                      <span className="font-semibold tabular-nums">{peso(lineAmount(item))}</span>
                    </li>
                  ))}
                </ul>
              </Detail>
            )}
            <Detail label={isSale ? 'Total' : 'Amount'}>
              <span className="text-3xl font-bold tabular-nums">{peso(isSale ? total : cleanAmount)}</span>
            </Detail>
            {!onCredit && (
              <Detail label="OR Number">
                <span className="text-xl font-bold tabular-nums">{orNumber.trim().toUpperCase()}</span>
              </Detail>
            )}
          </dl>
        </Modal>
      )}
    </>
  );
}
