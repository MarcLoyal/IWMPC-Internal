import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAYMENT_TYPE, peso } from '../lib/format';
import type { AccountList, AccountProfile, AccountRow, Payment, PaymentType, Settings } from '../lib/types';
import { useDebounced, useLoad } from '../lib/useLoad';
import { Button, Card, Detail, Field, LinkButton, Loading, MemberBadge, Modal, Notice, PageHeader } from '../components/ui';

const TYPES: PaymentType[] = ['INSTALLATION_FEE', 'MEMBERSHIP_FEE', 'OTHER'];
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

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
  const results = useLoad<AccountList>(!accountId && debounced.trim() ? `/accounts?search=${encodeURIComponent(debounced.trim())}` : null);
  const profile = useLoad<AccountProfile>(accountId ? `/accounts/${accountId}` : null);
  const settings = useLoad<Settings>('/settings');

  const [type, setType] = useState<PaymentType | ''>('');
  const [amount, setAmount] = useState('');
  const [orNumber, setOrNumber] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Payment | null>(null);

  function resetForm() {
    setType('');
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
    setParams(a ? { account: String(a.id) } : {}, { replace: true });
  }

  function pickType(next: PaymentType, presetAmount?: string) {
    setType(next);
    setError('');
    const fee = next === 'MEMBERSHIP_FEE' ? settings.data?.membership_fee : next === 'INSTALLATION_FEE' ? settings.data?.installation_fee : '';
    const value = presetAmount ?? fee ?? '';
    setAmount(Number(value) > 0 ? value : '');
  }

  const cleanAmount = amount.replace(/[₱,\s]/g, '');
  const account = profile.data?.account;

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
            {PAYMENT_TYPE[saved.type]} from <strong>{saved.accountName}</strong>
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
                placeholder="Type a name, account number, or member number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {results.error && (
                <Notice tone="error" className="mt-3">
                  {results.error}
                </Notice>
              )}
              {debounced.trim() && results.data && (
                <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {results.data.rows.slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => pickAccount(a)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-brand-50">
                        <span>
                          <span className="text-lg font-semibold">{a.fullName}</span>
                          <span className="ml-3 text-slate-500">
                            {a.accountNumber} · {a.area}
                          </span>
                        </span>
                        <MemberBadge isMember={a.isMember} />
                      </button>
                    </li>
                  ))}
                  {results.data.rows.length === 0 && <li className="px-4 py-4 text-slate-500">No account found with that name.</li>}
                  {results.data.total > 8 && <li className="px-4 py-2 text-sm text-slate-500">More accounts match. Type more of the name.</li>}
                </ul>
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
                    <li key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                      <span className="font-semibold">{o.label}</span>
                      <span className="flex items-center gap-4">
                        <span className="text-xl font-bold tabular-nums">{peso(o.amount)}</span>
                        <Button onClick={() => pickType(o.type, o.amount)}>Pay This</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6">
              <StepTitle n={3}>Payment</StepTitle>
              <div className="label">Payment type</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    onClick={() => pickType(t)}
                    className={`rounded-lg border-2 px-4 py-3 text-lg font-semibold ${
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
                  <Field label="Amount (₱)" hint={type === 'MEMBERSHIP_FEE' ? 'The membership fee must be paid in full.' : undefined}>
                    <input className="input text-xl font-semibold tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </Field>
                  <Field label="OR Number" hint="From the paper Official Receipt you issued.">
                    <input className="input text-xl font-semibold tabular-nums" value={orNumber} onChange={(e) => setOrNumber(e.target.value)} autoComplete="off" />
                  </Field>
                </div>
              )}

              {error && (
                <Notice tone="error" className="mt-5">
                  {error}
                </Notice>
              )}
              <Button variant="primary" className="mt-6 px-6 py-3 text-lg" onClick={review} disabled={!type}>
                Review Payment
              </Button>
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
