import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, peso } from '../lib/format';
import { PAYOFF_RULE, type LoanType } from '../lib/loans';
import type { Settings } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Button, Card, Field, Loading, Modal, Notice, PageHeader } from '../components/ui';

type TypeWithHistory = LoanType & { changes: { at: string; by: string | null; reason: string; before: unknown; after: unknown }[] };

/** Admin: the loan limit, early payment rule, and loan types. Every change needs a reason. */
export function LoanSettings() {
  const settings = useLoad<Settings>('/settings');
  const types = useLoad<{ loanTypes: TypeWithHistory[] }>('/loans/types');
  const [editing, setEditing] = useState<TypeWithHistory | 'new' | null>(null);

  return (
    <>
      <PageHeader title="Loan Settings" subtitle="Only Admins can change these. Each loan keeps the terms it was made with." back={{ to: '/settings', label: 'Back to Settings' }}>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Add Loan Type
        </Button>
      </PageHeader>
      {settings.data && <Rules settings={settings.data} onSaved={settings.reload} />}

      <h2 className="mb-3 mt-6 text-xl font-bold">Loan types</h2>
      {types.error && <Notice tone="error">{types.error}</Notice>}
      {types.loading && !types.data && <Loading what="loan types" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {types.data?.loanTypes.map((t) => (
          <TypeCard key={t.id} type={t} onEdit={() => setEditing(t)} />
        ))}
      </div>
      {editing && (
        <TypeDialog
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void types.reload();
          }}
        />
      )}
    </>
  );
}

function Rules({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [percent, setPercent] = useState(settings.loan_limit_percent);
  const [rule, setRule] = useState(settings.loan_payoff_rule);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPercent(settings.loan_limit_percent);
    setRule(settings.loan_payoff_rule);
  }, [settings]);
  const changed = percent !== settings.loan_limit_percent || rule !== settings.loan_payoff_rule;

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { loan_limit_percent: percent, loan_payoff_rule: rule, reason });
      setSaved(true);
      setReason('');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-bold">Loan limit and early payment</h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <Field label="A member can borrow up to (% of paid-up share capital)" hint="Less the principal still unpaid on their other loans.">
          <input className="input text-xl font-bold" inputMode="numeric" value={percent} onChange={(e) => { setSaved(false); setPercent(e.target.value); }} />
        </Field>
        <Field label="Paying the whole loan early">
          <select className="input" value={rule} onChange={(e) => { setSaved(false); setRule(e.target.value as Settings['loan_payoff_rule']); }}>
            {(Object.keys(PAYOFF_RULE) as (keyof typeof PAYOFF_RULE)[]).map((k) => (
              <option key={k} value={k}>
                {PAYOFF_RULE[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {changed && (
        <Field label="Reason for the change (required)" className="mt-4" hint="Kept in the history of changes.">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Board resolution no. 12" />
        </Field>
      )}
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
      {saved && (
        <Notice tone="success" className="mt-4">
          Saved.
        </Notice>
      )}
      <Button variant="primary" className="mt-4" onClick={save} disabled={!changed || !reason.trim() || saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Card>
  );
}

const tsc = (t: LoanType) => (t.tscType === 'PERCENT' ? `${t.tscValue}%` : peso(t.tscValue));
const penalty = (t: LoanType) =>
  t.penaltyType === 'NONE' ? 'None' : t.penaltyType === 'PERCENT' ? `${t.penaltyValue}% of the installment a month` : `${peso(t.penaltyValue)} a month per installment`;

function TypeCard({ type: t, onEdit }: { type: TypeWithHistory; onEdit: () => void }) {
  const [history, setHistory] = useState(false);
  return (
    <Card className={`p-5 ${t.active ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{t.name}</h3>
          {!t.active && <div className="font-semibold text-slate-500">Not offered</div>}
        </div>
        <Button onClick={onEdit}>Edit</Button>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-lg sm:grid-cols-2">
        <div>Interest: <strong>{t.monthlyRate}% a month</strong></div>
        <div>Terms: <strong>{t.minMonths}–{t.maxMonths} months</strong></div>
        <div>Service charge: <strong>{t.serviceChargePercent}%</strong></div>
        <div>TSC: <strong>{tsc(t)}</strong></div>
        <div>Notarial fee: <strong>{peso(t.notarialFee)}</strong></div>
        {Number(t.otherChargeAmount) > 0 && <div>{t.otherChargeLabel || 'Other'}: <strong>{peso(t.otherChargeAmount)}</strong></div>}
        <div className="sm:col-span-2">Late penalty: <strong>{penalty(t)}</strong></div>
      </dl>
      {t.changes.length > 0 && (
        <button type="button" className="mt-3 font-semibold text-brand-700 underline" onClick={() => setHistory((h) => !h)}>
          {history ? 'Hide history of changes' : `History of changes (${t.changes.length})`}
        </button>
      )}
      {history && (
        <ul className="mt-2 divide-y divide-slate-100 text-slate-700">
          {t.changes.map((c, i) => (
            <li key={i} className="py-1.5">
              {formatDateTime(c.at)} · {c.by ?? '—'} · {c.reason}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TypeDialog({ type, onClose, onDone }: { type: LoanType | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({
    name: type?.name ?? '',
    monthlyRate: type?.monthlyRate ?? '3.00',
    minMonths: String(type?.minMonths ?? 1),
    maxMonths: String(type?.maxMonths ?? 12),
    serviceChargePercent: type?.serviceChargePercent ?? '1.00',
    tscType: type?.tscType ?? 'AMOUNT',
    tscValue: type?.tscValue ?? '30.00',
    notarialFee: type?.notarialFee ?? '0.00',
    otherChargeLabel: type?.otherChargeLabel ?? '',
    otherChargeAmount: type?.otherChargeAmount ?? '0.00',
    penaltyType: type?.penaltyType ?? 'NONE',
    penaltyValue: type?.penaltyValue ?? '0.00',
    active: type?.active ?? true,
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (type) await api.put(`/loans/types/${type.id}`, { ...v, reason });
      else await api.post('/loans/types', v);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={type ? `Edit ${type.name}` : 'New Loan Type'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || (!!type && !reason.trim())}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input className="input" value={v.name} onChange={set('name')} placeholder="e.g. Credit Loan" autoFocus />
        </Field>
        <Field label="Interest per month (%)">
          <input className="input" inputMode="decimal" value={v.monthlyRate} onChange={set('monthlyRate')} />
        </Field>
        <Field label="How it is worked out">
          <select className="input" value="DIMINISHING_EQUAL" disabled>
            <option value="DIMINISHING_EQUAL">Diminishing balance, equal monthly payments</option>
          </select>
        </Field>
        <Field label="Shortest term (months)">
          <input className="input" inputMode="numeric" value={v.minMonths} onChange={set('minMonths')} />
        </Field>
        <Field label="Longest term (months)">
          <input className="input" inputMode="numeric" value={v.maxMonths} onChange={set('maxMonths')} />
        </Field>
        <Field label="Service charge (% of the loan)">
          <input className="input" inputMode="decimal" value={v.serviceChargePercent} onChange={set('serviceChargePercent')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="TSC is">
            <select className="input" value={v.tscType} onChange={set('tscType')}>
              <option value="AMOUNT">An amount (₱)</option>
              <option value="PERCENT">A percent</option>
            </select>
          </Field>
          <Field label={v.tscType === 'PERCENT' ? 'TSC (%)' : 'TSC (₱)'}>
            <input className="input" inputMode="decimal" value={v.tscValue} onChange={set('tscValue')} />
          </Field>
        </div>
        <Field label="Notarial fee (₱)">
          <input className="input" inputMode="decimal" value={v.notarialFee} onChange={set('notarialFee')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Other charge (name)">
            <input className="input" value={v.otherChargeLabel} onChange={set('otherChargeLabel')} placeholder="optional" />
          </Field>
          <Field label="Other charge (₱)">
            <input className="input" inputMode="decimal" value={v.otherChargeAmount} onChange={set('otherChargeAmount')} />
          </Field>
        </div>
        <Field label="Late penalty">
          <select className="input" value={v.penaltyType} onChange={set('penaltyType')}>
            <option value="NONE">None</option>
            <option value="PERCENT">A percent of the installment, each month late</option>
            <option value="AMOUNT">An amount (₱), each month late</option>
          </select>
        </Field>
        {v.penaltyType !== 'NONE' && (
          <Field label={v.penaltyType === 'PERCENT' ? 'Penalty (%)' : 'Penalty (₱)'}>
            <input className="input" inputMode="decimal" value={v.penaltyValue} onChange={set('penaltyValue')} />
          </Field>
        )}
        <label className="flex items-center gap-3 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5" checked={v.active} onChange={(e) => setV((x) => ({ ...x, active: e.target.checked }))} />
          <span className="font-semibold">Offered for new loans</span>
        </label>
        {type && (
          <Field label="Reason for the change (required)" className="sm:col-span-2" hint="Loans already made keep their own terms.">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Board resolution no. 12" />
          </Field>
        )}
      </div>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
