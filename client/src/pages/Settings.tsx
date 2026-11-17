import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Area, Settings as SettingsData } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Button, Card, Field, LinkButton, Loading, Modal, Notice, PageHeader, buttonClass } from '../components/ui';
import { SignatureSettings } from '../components/SignatureSettings';
import { formatDateTime } from '../lib/format';

type Values = Record<string, string>;

/** One settings group with its own Save button. */
function Section({
  title,
  help,
  keys,
  settings,
  onSaved,
  children,
  reasonKeys = [],
}: {
  title: string;
  help?: string;
  keys: (keyof SettingsData)[];
  settings: SettingsData;
  onSaved: () => void;
  /** Money settings: changing one needs a reason, and their history can be shown. */
  reasonKeys?: (keyof SettingsData)[];
  children: (values: Values, set: (key: string) => (e: { target: { value: string } }) => void) => ReactNode;
}) {
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const moneyChanged = reasonKeys.some((k) => {
    const a = values[k as string];
    const b = settings[k] as string;
    return a !== undefined && a !== b && !(a.trim() !== '' && Number(a) === Number(b));
  });

  useEffect(() => {
    setValues(Object.fromEntries(keys.map((k) => [k, settings[k]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const set = (key: string) => (e: { target: { value: string } }) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { ...values, ...(moneyChanged ? { reason } : {}) });
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
      <form onSubmit={submit}>
        <h2 className="text-xl font-bold">{title}</h2>
        {help && <p className="mt-1 text-slate-600">{help}</p>}
        <div className="mt-4">{children(values, set)}</div>
        {moneyChanged && (
          <Field label="Reason for the change (required)" hint="Bills already made keep the amounts they were made with." className="mt-4">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Board resolution no. 12" />
          </Field>
        )}
        {error && (
          <Notice tone="error" className="mt-4">
            {error}
          </Notice>
        )}
        <div className="mt-5 flex items-center gap-4">
          <button type="submit" disabled={saving} className={buttonClass('primary')}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="font-semibold text-emerald-700">✓ Saved</span>}
          {reasonKeys.length > 0 && (
            <button type="button" className="ml-auto font-semibold text-brand-700 underline" onClick={() => setShowHistory(true)}>
              History of changes
            </button>
          )}
        </div>
      </form>
      {showHistory && <SettingHistory keys={reasonKeys as string[]} onClose={() => setShowHistory(false)} />}
    </Card>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  water_penalty_type: 'Kind of late penalty',
  water_penalty_value: 'Late penalty',
  reconnection_fee: 'Reconnection fee',
};

/** Old and new values, who changed them, when and why. */
function SettingHistory({ keys, onClose }: { keys: string[]; onClose: () => void }) {
  const { data, error, loading } = useLoad<{ history: { id: number; key: string; oldValue: string | null; newValue: string; reason: string; changedBy: string | null; changedAt: string }[] }>(
    `/settings/history?keys=${keys.join(',')}`,
  );
  return (
    <Modal
      title="History of changes"
      wide
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading && !data && <Loading />}
      {error && <Notice tone="error">{error}</Notice>}
      {data && data.history.length === 0 && <p className="text-slate-600">No changes have been recorded yet.</p>}
      {data && data.history.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {data.history.map((h) => (
            <li key={h.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-bold">{HISTORY_LABEL[h.key] ?? h.key}</span>
                <span className="tabular-nums">
                  <span className="text-slate-500">{h.oldValue ?? '—'} → </span>
                  <strong>{h.newValue}</strong>
                </span>
              </div>
              <div className="text-sm text-slate-600">
                {formatDateTime(h.changedAt)} · {h.changedBy ?? '—'}
                {h.reason && ` · Reason: ${h.reason}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Areas() {
  const { data, error, reload } = useLoad<{ areas: Area[] }>('/areas');
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [problem, setProblem] = useState('');

  async function run(action: () => Promise<unknown>) {
    setProblem('');
    try {
      await action();
      setEditing(null);
      setNewName('');
      await reload();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-bold">Areas</h2>
      <p className="mt-1 text-slate-600">Areas can be added or renamed. They cannot be removed.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {data?.areas.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            {editing === a.id ? (
              <>
                <input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} aria-label="Area name" autoFocus />
                <span className="flex gap-2">
                  <Button variant="primary" onClick={() => run(() => api.put(`/areas/${a.id}`, { name }))}>
                    Save
                  </Button>
                  <Button onClick={() => setEditing(null)}>Cancel</Button>
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold">{a.name}</span>
                <Button
                  onClick={() => {
                    setEditing(a.id);
                    setName(a.name);
                    setProblem('');
                  }}
                >
                  Rename
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.post('/areas', { name: newName }));
        }}
      >
        <Field label="New area" className="min-w-[200px] flex-1 sm:max-w-xs">
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Field>
        <button type="submit" disabled={!newName.trim()} className={buttonClass('secondary')}>
          + Add Area
        </button>
      </form>
      {problem && (
        <Notice tone="error" className="mt-4">
          {problem}
        </Notice>
      )}
    </Card>
  );
}

export function Settings() {
  const { data, error, loading, reload } = useLoad<SettingsData>('/settings');

  return (
    <>
      <PageHeader title="Settings" subtitle="Only Admins can see and change these.">
        <LinkButton to="/settings/water-rates">Water Rates</LinkButton>
        <LinkButton to="/prices">Rice &amp; LPG Prices</LinkButton>
        <LinkButton to="/settings/users">Users and Roles</LinkButton>
      </PageHeader>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading />}
      {data && (
        <div className="max-w-3xl space-y-5">
          <Section title="Cooperative Info" help="Shown at the top of reports and printouts." keys={['coop_name', 'coop_address', 'coop_cda_no']} settings={data} onSaved={reload}>
            {(v, set) => (
              <div className="grid gap-4">
                <Field label="Cooperative name">
                  <input className="input" value={v.coop_name ?? ''} onChange={set('coop_name')} />
                </Field>
                <Field label="Address">
                  <input className="input" value={v.coop_address ?? ''} onChange={set('coop_address')} />
                </Field>
                <Field label="CDA registration number" className="sm:max-w-xs">
                  <input className="input" value={v.coop_cda_no ?? ''} onChange={set('coop_cda_no')} />
                </Field>
              </div>
            )}
          </Section>

          <Section title="Fees" keys={['membership_fee', 'installation_fee']} settings={data} onSaved={reload}>
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Membership fee (₱)" hint="Must be paid in full to become a member.">
                  <input className="input tabular-nums" inputMode="decimal" value={v.membership_fee ?? ''} onChange={set('membership_fee')} />
                </Field>
                <Field label="Installation fee (₱)">
                  <input className="input tabular-nums" inputMode="decimal" value={v.installation_fee ?? ''} onChange={set('installation_fee')} />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title="Invoice Booklet"
            help="The BIR Service Invoice booklets printed under the Authority to Print (ATP). The system does not print invoices; it only shows a guide to copy from."
            keys={['invoice_atp_no', 'invoice_atp_date', 'invoice_series_from', 'invoice_series_to', 'invoice_tin_line', 'invoice_phone_line']}
            settings={data}
            onSaved={reload}
          >
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ATP No.">
                  <input className="input" value={v.invoice_atp_no ?? ''} onChange={set('invoice_atp_no')} />
                </Field>
                <Field label="Date the ATP was issued">
                  <input className="input" type="date" value={v.invoice_atp_date ?? ''} onChange={set('invoice_atp_date')} />
                </Field>
                <Field label="First invoice number in the series">
                  <input className="input tabular-nums" inputMode="numeric" value={v.invoice_series_from ?? ''} onChange={set('invoice_series_from')} />
                </Field>
                <Field label="Last invoice number in the series" hint="Home shows a warning when fewer than 2,000 numbers are left.">
                  <input className="input tabular-nums" inputMode="numeric" value={v.invoice_series_to ?? ''} onChange={set('invoice_series_to')} />
                </Field>
                <Field label="TIN line on the invoice">
                  <input className="input" value={v.invoice_tin_line ?? ''} onChange={set('invoice_tin_line')} />
                </Field>
                <Field label="Phone line on the invoice">
                  <input className="input" value={v.invoice_phone_line ?? ''} onChange={set('invoice_phone_line')} />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title="Water Billing"
            help="These apply to bills made from now on. Bills already made keep their own due date and penalty. Water rates are on their own page (button above)."
            keys={['water_due_rule', 'water_due_day', 'water_due_days', 'water_penalty_type', 'water_penalty_value', 'water_disconnect_months']}
            reasonKeys={['water_penalty_type', 'water_penalty_value']}
            settings={data}
            onSaved={reload}
          >
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Due date of new bills">
                  <select className="input" value={v.water_due_rule ?? 'DAY_OF_NEXT_MONTH'} onChange={set('water_due_rule')}>
                    <option value="DAY_OF_NEXT_MONTH">A set day of the next month</option>
                    <option value="DAYS_AFTER_READING">A number of days after the reading</option>
                  </select>
                </Field>
                {v.water_due_rule === 'DAYS_AFTER_READING' ? (
                  <Field label="Days after the meter reading">
                    <input className="input tabular-nums" inputMode="numeric" value={v.water_due_days ?? ''} onChange={set('water_due_days')} />
                  </Field>
                ) : (
                  <Field label="Due day of the month" hint="e.g. 15: an October reading is due November 15. Printed on the bill.">
                    <input className="input tabular-nums" inputMode="numeric" value={v.water_due_day ?? ''} onChange={set('water_due_day')} />
                  </Field>
                )}
                <Field label="Disconnection list: unpaid months" hint="Accounts with this many overdue months are listed. Nothing is disconnected automatically.">
                  <input className="input tabular-nums" inputMode="numeric" value={v.water_disconnect_months ?? ''} onChange={set('water_disconnect_months')} />
                </Field>
                <Field label="Late penalty">
                  <select className="input" value={v.water_penalty_type ?? 'PERCENT'} onChange={set('water_penalty_type')}>
                    <option value="PERCENT">A percent of the bill</option>
                    <option value="FIXED">A fixed amount in pesos</option>
                  </select>
                </Field>
                <Field label={v.water_penalty_type === 'FIXED' ? 'Penalty amount (₱)' : 'Penalty percent (%)'} hint="Use 0 for no penalty.">
                  <input className="input tabular-nums" inputMode="decimal" value={v.water_penalty_value ?? ''} onChange={set('water_penalty_value')} />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title="Printed Monthly Bill"
            help="Shown on every printed monthly bill."
            keys={['coop_phone', 'coop_mobile', 'bill_paper', 'bill_preparer_name', 'bill_preparer_title', 'bill_cashier_name', 'bill_cashier_title', 'bill_manager_name', 'bill_manager_title']}
            settings={data}
            onSaved={reload}
          >
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone No.">
                  <input className="input" value={v.coop_phone ?? ''} onChange={set('coop_phone')} />
                </Field>
                <Field label="Mobile No.">
                  <input className="input" value={v.coop_mobile ?? ''} onChange={set('coop_mobile')} />
                </Field>
                <Field label="Paper size" className="sm:col-span-2">
                  <select className="input" value={v.bill_paper ?? 'LETTER'} onChange={set('bill_paper')}>
                    <option value="LETTER">Short bond (Letter, 8.5 × 11 in)</option>
                    <option value="LONG">Long bond (8.5 × 13 in)</option>
                  </select>
                </Field>
                {(
                  [
                    ['bill_preparer', 'Prepared by'],
                    ['bill_cashier', 'Second signature'],
                    ['bill_manager', 'Third signature'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="contents">
                    <Field label={`${label}: name`}>
                      <input className="input" value={v[`${key}_name`] ?? ''} onChange={set(`${key}_name`)} />
                    </Field>
                    <Field label={`${label}: title`}>
                      <input className="input" value={v[`${key}_title`] ?? ''} onChange={set(`${key}_title`)} />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Printed 2-Month Notice"
            help="Accounts with this many unpaid months (counting the month being billed) get this notice instead of the monthly bill."
            keys={[
              'notice_phone_line',
              'notice_threshold_months',
              'notice_per_page',
              'disconnect_days_after_due',
              'reconnection_fee',
              'notice_preparer_name',
              'notice_preparer_title',
              'notice_cashier_name',
              'notice_cashier_title',
              'notice_manager_name',
              'notice_manager_title',
            ]}
            reasonKeys={['reconnection_fee']}
            settings={data}
            onSaved={reload}
          >
            {(v, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone line" hint="Printed under the CDA number." className="sm:col-span-2">
                  <input className="input" value={v.notice_phone_line ?? ''} onChange={set('notice_phone_line')} />
                </Field>
                <Field label="Unpaid months that start the notice">
                  <input className="input tabular-nums" inputMode="numeric" value={v.notice_threshold_months ?? ''} onChange={set('notice_threshold_months')} />
                </Field>
                <Field label="Notices per page">
                  <select className="input" value={v.notice_per_page ?? '1'} onChange={set('notice_per_page')}>
                    <option value="1">1 per page (landscape, like the paper form)</option>
                    <option value="2">2 per page</option>
                  </select>
                </Field>
                <Field label="Disconnection date: days after the due date" hint="Can be changed for a whole batch when printing.">
                  <input className="input tabular-nums" inputMode="numeric" value={v.disconnect_days_after_due ?? ''} onChange={set('disconnect_days_after_due')} />
                </Field>
                <Field label="Reconnection fee (₱)">
                  <input className="input tabular-nums" inputMode="decimal" value={v.reconnection_fee ?? ''} onChange={set('reconnection_fee')} />
                </Field>
                {(
                  [
                    ['notice_preparer', 'Prepared by'],
                    ['notice_cashier', 'Second signature'],
                    ['notice_manager', 'Third signature'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="contents">
                    <Field label={`${label}: name`}>
                      <input className="input" value={v[`${key}_name`] ?? ''} onChange={set(`${key}_name`)} />
                    </Field>
                    <Field label={`${label}: title`}>
                      <input className="input" value={v[`${key}_title`] ?? ''} onChange={set(`${key}_title`)} />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <SignatureSettings names={data as unknown as Record<string, string>} />

          <Section
            title="Rice & LPG"
            help="Products and prices are on their own page (button above)."
            keys={['allow_credit']}
            settings={data}
            onSaved={reload}
          >
            {(v, set) => (
              <Field
                label="Allow credit (utang)"
                hint="When Yes, the Cashier can sell Rice & LPG to an account without payment. The amount is added to what the account owes Each credit sale is written on a Charge Sales invoice."
                className="sm:max-w-md"
              >
                <select className="input" value={v.allow_credit ?? 'false'} onChange={set('allow_credit')}>
                  <option value="false">No, cash only</option>
                  <option value="true">Yes, allow credit</option>
                </select>
              </Field>
            )}
          </Section>

          <Section
            title="Account and Member Numbers"
            help="New accounts and new members get the next number automatically. Numbers already in use are skipped."
            keys={['account_no_prefix', 'account_no_padding', 'account_no_next', 'member_no_prefix', 'member_no_padding', 'member_no_next']}
            settings={data}
            onSaved={reload}
          >
            {(v, set) => (
              <div className="space-y-5">
                {(['account', 'member'] as const).map((kind) => (
                  <div key={kind}>
                    <div className="mb-2 font-semibold">
                      {kind === 'account' ? 'Account number' : 'Member number'}{' '}
                      <span className="font-normal text-slate-600">
                        · next one will be{' '}
                        <strong className="tabular-nums text-slate-900">
                          {(v[`${kind}_no_prefix`] ?? '') + String(v[`${kind}_no_next`] ?? '').padStart(Number(v[`${kind}_no_padding`]) || 1, '0')}
                        </strong>
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Starts with" hint="e.g. A- or M- (can be blank)">
                        <input className="input" value={v[`${kind}_no_prefix`] ?? ''} onChange={set(`${kind}_no_prefix`)} />
                      </Field>
                      <Field label="Number of digits">
                        <input className="input tabular-nums" inputMode="numeric" value={v[`${kind}_no_padding`] ?? ''} onChange={set(`${kind}_no_padding`)} />
                      </Field>
                      <Field label="Next number">
                        <input className="input tabular-nums" inputMode="numeric" value={v[`${kind}_no_next`] ?? ''} onChange={set(`${kind}_no_next`)} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Areas />
        </div>
      )}
    </>
  );
}
