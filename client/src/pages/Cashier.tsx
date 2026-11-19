import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAYMENT_TYPE, peso } from '../lib/format';
import type { AccountList, AccountProfile, AccountRow, BillStatus, OwedItem, PaymentType, Product, Settings } from '../lib/types';
import { SaleBuilder, cartTotal, type CartItem } from '../components/SaleBuilder';
import { InvoiceGuideModal, type Guide } from '../components/InvoiceGuide';
import { useDebounced, useLoad } from '../lib/useLoad';
import { BILL_STATUS } from '../lib/water';
import { Badge, Button, Card, Field, LinkButton, Loading, Notice, PageHeader } from '../components/ui';

const TYPES: PaymentType[] = ['WATER_BILL', 'RICE_LPG', 'INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'SHARE_CAPITAL', 'OTHER'];
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

/** One thing being paid on this invoice, as the server expects it, plus what the cashier sees. */
type Payload =
  | { type: 'WATER_BILL'; waterBillId: number; amount: string }
  | { type: 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'SHARE_CAPITAL'; amount: string }
  | { type: 'OTHER'; amount: string; description: string }
  | { type: 'RICE_LPG'; saleId: number; amount: string }
  | { type: 'SALE'; items: { unitId: number; quantity: string }[] }
  | { type: 'LOAN'; loanId: number; amount: string; payoff: boolean };

interface Item {
  key: string;
  label: string;
  amount: number;
  payload: Payload;
}

interface NumberCheck {
  number: string;
  used: string | null;
  warning: string | null;
}

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

const owedKey = (o: OwedItem) => (o.loanId ? `loan-${o.loanId}` : o.waterBillId ? `bill-${o.waterBillId}` : o.saleId ? `sale-${o.saleId}` : `owed-${o.type}`);

export function Cashier() {
  const { canDo } = useAuth();
  const navigate = useNavigate();
  const canReceive = canDo('CASHIER');
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

  // ---- The invoice being made
  const [items, setItems] = useState<Item[]>([]);
  const [adding, setAdding] = useState<PaymentType | ''>('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [billChoice, setBillChoice] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [credit, setCredit] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [number, setNumber] = useState('');
  const [check, setCheck] = useState<NumberCheck | null>(null);
  const [error, setError] = useState('');
  // The guide pop-up: a preview before saving, then the saved invoice.
  const [review, setReview] = useState<{ guide: Guide; warning: string | null } | null>(null);
  const [saved, setSaved] = useState<{ guide: Guide; accountId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accountId && String(profile.data?.account.id) === accountId ? profile.data?.account : undefined;
  const owed = account ? (profile.data?.owed ?? []) : [];
  const fee = Number(settings.data?.membership_fee ?? 0);
  const creditAllowed = settings.data?.allow_credit === 'true' && !!account;
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const inInvoice = new Set(items.map((i) => i.key));

  function resetInvoice() {
    setItems([]);
    setAdding(walkIn ? 'RICE_LPG' : '');
    setAmount('');
    setDescription('');
    setBillChoice('');
    setCart([]);
    setCredit(false);
    setError('');
    setReview(null);
  }
  // A different account always starts with a clean invoice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetInvoice, [accountId, walkIn]);

  // The next number for this cashier (last + 1), always editable.
  const suggest = useCallback(async () => {
    try {
      const res = await api.get<{ next: string }>('/invoices/suggest');
      setNumber(res.next);
    } catch {
      setNumber('');
    }
  }, []);
  useEffect(() => {
    if (canReceive) void suggest();
  }, [canReceive, suggest]);

  // Checks the typed number as the cashier types: used (blocked) or outside the series (warning).
  const debouncedNumber = useDebounced(number.trim(), 350);
  useEffect(() => {
    if (!canReceive || !debouncedNumber) return setCheck(null);
    let stale = false;
    api
      .get<NumberCheck>(`/invoices/check?number=${encodeURIComponent(debouncedNumber)}`)
      .then((res) => !stale && setCheck(res))
      .catch(() => !stale && setCheck(null));
    return () => {
      stale = true;
    };
  }, [debouncedNumber, canReceive]);
  const numberCheck = check && check.number === debouncedNumber.toUpperCase() ? check : null;

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

  function addItem(item: Item) {
    setItems((list) => [...list.filter((i) => i.key !== item.key), item]);
    setAdding(walkIn ? 'RICE_LPG' : '');
    setAmount('');
    setDescription('');
    setBillChoice('');
    setCart([]);
    setError('');
  }

  /** "Add" beside something they owe. */
  function addOwed(o: OwedItem) {
    const amt = Number(o.amount);
    if (o.type === 'WATER_BILL' && o.waterBillId) {
      addItem({ key: owedKey(o), label: o.label, amount: amt, payload: { type: 'WATER_BILL', waterBillId: o.waterBillId, amount: o.amount } });
    } else if (o.type === 'RICE_LPG' && o.saleId) {
      addItem({ key: owedKey(o), label: o.label, amount: amt, payload: { type: 'RICE_LPG', saleId: o.saleId, amount: o.amount } });
    } else if (o.type === 'INSTALLATION_FEE' || o.type === 'MEMBERSHIP_FEE') {
      addItem({ key: owedKey(o), label: o.label, amount: amt, payload: { type: o.type, amount: o.amount } });
    }
  }

  const unpaidWater = owed.filter((o) => o.type === 'WATER_BILL');

  /** A loan payment: the server works out the split (penalty → interest → principal) to show on the line. */
  async function addLoan(o: OwedItem, amt: string, payoff: boolean) {
    setError('');
    const clean = amt.replace(/[₱,\s]/g, '');
    if (!AMOUNT.test(clean) || Number(clean) <= 0) return setError('Please enter a valid amount, for example 553.79.');
    try {
      const s = await api.get<{ penalty: string; interest: string; principal: string }>(`/loans/${o.loanId}/split?amount=${clean}&payoff=${payoff}`);
      const parts = [Number(s.penalty) > 0 ? `penalty ${peso(s.penalty)}` : '', `interest ${peso(s.interest)}`, `principal ${peso(s.principal)}`].filter(Boolean).join(', ');
      const what = o.label.split(' · ')[0];
      addItem({ key: owedKey(o), label: `${what}${payoff ? ', paid off' : ''} (${parts})`, amount: Number(clean), payload: { type: 'LOAN', loanId: o.loanId!, amount: clean, payoff } });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /** The small form under the payment type buttons. */
  function addTyped() {
    const clean = amount.replace(/[₱,\s]/g, '');
    const valid = AMOUNT.test(clean) && Number(clean) > 0;
    if (adding === 'RICE_LPG') {
      if (!cart.length) return setError('Please add at least one item.');
      const label = `Rice & LPG: ${cart.map((c) => `${c.productName} ${c.quantity} × ${c.unitLabel}`).join('; ')}`;
      return addItem({ key: `sale-${Date.now()}`, label, amount: cartTotal(cart), payload: { type: 'SALE', items: cart.map((c) => ({ unitId: c.unitId, quantity: c.quantity })) } });
    }
    if (!valid) return setError('Please enter a valid amount, for example 1250.00.');
    const amt = Number(clean);
    if (adding === 'WATER_BILL') {
      const o = unpaidWater.find((w) => String(w.waterBillId) === billChoice) ?? unpaidWater[0];
      if (!o?.waterBillId) return setError('This account has no unpaid water bill.');
      if (amt > Number(o.amount)) return setError(`That is more than what is owed for this bill (${peso(o.amount)}).`);
      return addItem({ key: owedKey(o), label: amt < Number(o.amount) ? `${o.label} (part payment)` : o.label, amount: amt, payload: { type: 'WATER_BILL', waterBillId: o.waterBillId, amount: clean } });
    }
    // Checked again on the server; said here first in plain words.
    const status = account?.membershipStatus;
    if (adding === 'MEMBERSHIP_FEE' && status !== 'PENDING') {
      return setError(
        status === 'FOR_APPROVAL'
          ? "This membership application is waiting for the Admin's approval. The fee can be received only after it is approved."
          : status === 'MEMBER'
            ? 'This account is already a member.'
            : status === 'NOT_APPROVED'
              ? 'This membership application was not approved by the Board, so no membership fee can be received.'
              : 'There is no approved membership application for this account yet. Staff submit the application first, then the Admin approves it.',
      );
    }
    if (adding === 'SHARE_CAPITAL' && status !== 'MEMBER' && status !== 'PENDING') {
      return setError('Only members, and applicants approved by the Admin, can pay share capital.');
    }
    if (adding === 'MEMBERSHIP_FEE' && amt < fee) return setError(`This is ${peso(fee - amt)} short. The membership fee is ${peso(fee)} and must be paid in full.`);
    if (adding === 'OTHER') {
      if (!description.trim()) return setError('Please type a short description of what this payment is for.');
      return addItem({ key: `other-${Date.now()}`, label: `Other: ${description.trim()}`, amount: amt, payload: { type: 'OTHER', amount: clean, description: description.trim() } });
    }
    if (adding === 'INSTALLATION_FEE' || adding === 'MEMBERSHIP_FEE' || adding === 'SHARE_CAPITAL') {
      return addItem({ key: `${adding}-${Date.now()}`, label: PAYMENT_TYPE[adding], amount: amt, payload: { type: adding, amount: clean } });
    }
  }

  function pickType(t: PaymentType) {
    setAdding(t);
    setError('');
    setDescription('');
    const firstBill = unpaidWater[0];
    setBillChoice(firstBill?.waterBillId ? String(firstBill.waterBillId) : '');
    const preset =
      t === 'WATER_BILL' ? firstBill?.amount : t === 'MEMBERSHIP_FEE' ? settings.data?.membership_fee : t === 'INSTALLATION_FEE' ? settings.data?.installation_fee : '';
    setAmount(Number(preset) > 0 ? String(preset) : '');
  }

  const body = () => ({ accountId: account?.id ?? null, walkInName, number: number.trim(), credit, items: items.map((i) => i.payload) });
  const blocked = !!numberCheck?.used;

  async function openReview() {
    if (!items.length) return setError('Please add at least one item to the invoice.');
    if (!number.trim()) return setError('Please enter the Invoice No. from the invoice booklet.');
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ guide: Guide; check: NumberCheck }>('/invoices/preview', body());
      if (res.check.used) return setError(res.check.used);
      setReview({ guide: res.guide, warning: res.check.warning });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await api.post<{ invoice: { id: number; number: string }; guide: Guide }>('/invoices', body());
      setReview(null);
      setSaved({ guide: res.guide, accountId: account?.id ?? null });
      void profile.reload();
    } catch (err) {
      setReview(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function closeSaved() {
    setSaved(null);
    resetInvoice();
    void suggest();
    pickAccount(null);
  }

  const header = (
    <PageHeader title="Cashier" subtitle="Receive payments and write them on a BIR Service Invoice from the booklet.">
      <LinkButton to="/cashier/find">Find by Invoice No.</LinkButton>
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

  const choice = (on: boolean) =>
    `rounded-lg border-2 px-3 py-2.5 text-base font-semibold ${on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white hover:border-slate-400'}`;

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

        {(account || walkIn) && (
          <>
            {account && (
              <Card className="p-6">
                <StepTitle n={2}>What they owe</StepTitle>
                {owed.length === 0 ? (
                  <p className="text-slate-600">Nothing unpaid on record. You can still add a payment below.</p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {owed.map((o) => {
                        const added = inInvoice.has(owedKey(o));
                        if (o.type === 'LOAN') return <LoanOwedRow key={owedKey(o)} o={o} added={added} onAdd={(amt, payoff) => void addLoan(o, amt, payoff)} />;
                        return (
                          <li
                            key={owedKey(o)}
                            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 ${
                              o.status === 'OVERDUE' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
                            }`}
                          >
                            <span className="font-semibold">
                              {o.label}
                              {o.status === 'OVERDUE' && <span className="ml-2 text-red-700">· Overdue</span>}
                            </span>
                            <span className="flex items-center gap-4">
                              <span className="text-xl font-bold tabular-nums">{peso(o.amount)}</span>
                              {added ? (
                                <span className="w-[120px] text-center font-semibold text-emerald-700">✓ On invoice</span>
                              ) : (
                                <Button className="w-[120px]" onClick={() => addOwed(o)}>
                                  Add
                                </Button>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {unpaidWater.filter((o) => !inInvoice.has(owedKey(o))).length > 1 && (
                      <Button className="mt-3" onClick={() => unpaidWater.forEach((o) => !inInvoice.has(owedKey(o)) && addOwed(o))}>
                        Add all unpaid water bills
                      </Button>
                    )}
                  </>
                )}
              </Card>
            )}

            <Card className="p-6">
              <StepTitle n={account ? 3 : 2}>{walkIn ? 'Rice & LPG sale' : 'Add a payment'}</StepTitle>
              {!walkIn && (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {TYPES.map((t) => (
                    <button key={t} type="button" aria-pressed={adding === t} onClick={() => pickType(t)} className={choice(adding === t)}>
                      {PAYMENT_TYPE[t]}
                    </button>
                  ))}
                </div>
              )}

              {adding === 'RICE_LPG' && (
                <div className={walkIn ? '' : 'mt-4'}>
                  {products.loading && !products.data ? (
                    <Loading what="products" />
                  ) : (
                    <SaleBuilder products={products.data?.products ?? []} isMember={account?.isMember ?? false} items={cart} onChange={setCart} />
                  )}
                  {creditAllowed && cart.length > 0 && items.length === 0 && (
                    <label className="mt-4 flex items-start gap-3">
                      <input type="checkbox" className="mt-1 h-5 w-5" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
                      <span>
                        <span className="font-semibold">Sell on credit (utang)</span>
                        <span className="block text-sm text-slate-600">Written on a Charge Sales invoice. The amount goes to what {account?.fullName} owes.</span>
                      </span>
                    </label>
                  )}
                  {cart.length > 0 && (
                    <Button variant="primary" className="mt-4" onClick={addTyped}>
                      Add to invoice
                    </Button>
                  )}
                </div>
              )}

              {adding && adding !== 'RICE_LPG' && (
                <div className="mt-4 flex flex-wrap items-end gap-4">
                  {adding === 'WATER_BILL' && (
                    <Field label="Which month">
                      <select
                        className="input w-auto"
                        value={billChoice}
                        onChange={(e) => {
                          setBillChoice(e.target.value);
                          const o = unpaidWater.find((w) => String(w.waterBillId) === e.target.value);
                          if (o) setAmount(o.amount);
                        }}
                      >
                        {unpaidWater.length === 0 && <option value="">No unpaid water bill</option>}
                        {unpaidWater.map((o) => (
                          <option key={o.waterBillId} value={o.waterBillId}>
                            {o.label} · {peso(o.amount)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {adding === 'OTHER' && (
                    <Field label="What is it for?" className="min-w-[220px] flex-1">
                      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Certification fee" />
                    </Field>
                  )}
                  <Field
                    label="Amount (₱)"
                    hint={adding === 'MEMBERSHIP_FEE' ? `At least ${peso(fee)}. The whole amount counts as share capital.` : adding === 'WATER_BILL' ? 'Part payment is allowed.' : undefined}
                  >
                    <input className="input w-40 text-xl font-semibold tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </Field>
                  <Button variant="primary" className="mb-6" onClick={addTyped}>
                    Add to invoice
                  </Button>
                </div>
              )}
              {error && !items.length && (
                <Notice tone="error" className="mt-4">
                  {error}
                </Notice>
              )}
            </Card>

            <Card className="p-6">
              <StepTitle n={account ? 4 : 3}>This invoice</StepTitle>
              {items.length === 0 ? (
                <p className="text-slate-600">Nothing added yet. Use &quot;Add&quot; above for each thing being paid. Several can go on one invoice.</p>
              ) : (
                <table className="w-full">
                  <tbody className="divide-y divide-slate-100">
                    {items.map((i) => (
                      <tr key={i.key}>
                        <td className="py-2 pr-3 font-semibold">{i.label}</td>
                        <td className="py-2 pr-3 text-right text-lg font-bold tabular-nums">{peso(i.amount)}</td>
                        <td className="py-2 text-right">
                          <Button className="px-3 py-1.5 text-sm" onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300">
                    <tr>
                      <td className="pt-2 text-lg font-bold">Total</td>
                      <td className="pt-2 text-right text-2xl font-bold tabular-nums">{peso(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Invoice No. (required)" hint="From the BIR Service Invoice booklet. The next number is filled in for you; change it if it is different.">
                  <input
                    className={`input text-2xl font-bold tabular-nums ${blocked ? 'border-red-500 bg-red-50' : numberCheck?.warning ? 'border-amber-500 bg-amber-50' : !number.trim() ? 'border-amber-500 bg-amber-50' : ''}`}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    autoComplete="off"
                    required
                    aria-required="true"
                    aria-invalid={blocked}
                  />
                </Field>
                <div className="self-end pb-7">
                  {blocked && <p className="font-semibold text-red-700">{numberCheck?.used}</p>}
                  {!blocked && numberCheck?.warning && <p className="font-semibold text-amber-800">⚠ {numberCheck.warning} You can still continue.</p>}
                </div>
              </div>

              {error && items.length > 0 && (
                <Notice tone="error" className="mt-2">
                  {error}
                </Notice>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <Button variant="primary" className="px-6 py-3 text-lg" onClick={openReview} disabled={busy || !items.length || !number.trim() || blocked}>
                  {busy ? 'Preparing…' : 'Review Payment'}
                </Button>
                {!items.length ? (
                  <span className="font-semibold text-slate-600">Add at least one item to continue.</span>
                ) : (
                  !number.trim() && <span className="font-semibold text-amber-800">Enter the Invoice No. to continue.</span>
                )}
              </div>
            </Card>
          </>
        )}
      </div>

      {review && (
        <InvoiceGuideModal
          title="Is this correct?"
          guide={review.guide}
          onClose={() => !busy && setReview(null)}
          top={
            <>
              <Notice tone="warning">
                <span className="font-bold">Not saved yet.</span> Check the values, then click &quot;Yes, Save Payment&quot;. Click &quot;Go Back&quot; to change anything.
              </Notice>
              {review.warning && <Notice tone="warning">⚠ {review.warning}</Notice>}
            </>
          }
          footer={
            <>
              <Button onClick={() => setReview(null)} disabled={busy}>
                Go Back
              </Button>
              <Button variant="success" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Yes, Save Payment'}
              </Button>
            </>
          }
        />
      )}
      {saved && (
        <InvoiceGuideModal
          title={`Saved · Invoice No. ${saved.guide.number}`}
          guide={saved.guide}
          onClose={closeSaved}
          top={
            <Notice tone="success">
              <span className="font-bold">✓ Payment saved under Invoice No. {saved.guide.number}.</span> Finish copying the values to the paper invoice, then click Close.
            </Notice>
          }
          footer={
            <>
              {saved.accountId && <Button onClick={() => navigate(`/accounts/${saved.accountId}`)}>View Account</Button>}
              <Button variant="primary" onClick={closeSaved}>
                Close
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

/** A loan under "What they owe": add what is due now, pay it off, or type another amount. */
function LoanOwedRow({ o, added, onAdd }: { o: OwedItem; added: boolean; onAdd: (amount: string, payoff: boolean) => void }) {
  const [other, setOther] = useState(false);
  const [amount, setAmount] = useState('');
  const late = o.status === 'OVERDUE';
  return (
    <li className={`rounded-lg border px-4 py-2.5 ${late ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-semibold">
          {o.label}
          {late && <span className="ml-2 text-red-700">· Overdue</span>}
          <span className="block text-sm font-normal text-slate-600">Left on the loan: {peso(o.balance ?? 0)}</span>
        </span>
        <span className="flex items-center gap-4">
          <span className="text-right">
            <span className="block text-xl font-bold tabular-nums">{peso(o.amount)}</span>
            <span className="block text-sm text-slate-600">{late ? 'due now' : 'next installment'}</span>
          </span>
          {added ? (
            <span className="w-[120px] text-center font-semibold text-emerald-700">✓ On invoice</span>
          ) : (
            <Button className="w-[120px]" onClick={() => onAdd(o.amount, false)} disabled={Number(o.amount) <= 0}>
              Add
            </Button>
          )}
        </span>
      </div>
      {!added && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => onAdd(o.payoffAmount ?? '0', true)}>
            Pay off the loan: {peso(o.payoffAmount ?? 0)}
          </button>
          {!other ? (
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setOther(true)}>
              Other amount
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <input className="input w-40 tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus aria-label="Other amount" />
              <Button onClick={() => onAdd(amount, false)} disabled={!amount.trim()}>
                Add this amount
              </Button>
            </span>
          )}
        </div>
      )}
    </li>
  );
}
