import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import type { MembershipApplication } from '../lib/types';
import { Button, Field, Modal, Notice } from './ui';

/** Today in the Philippines, as YYYY-MM-DD. */
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

/**
 * Admin only: records the Board's decision on a waiting membership application.
 * The Board decides in its meeting; the Admin enters the result here.
 */
export function MembershipDecisionModal({
  accountId,
  name,
  application,
  onClose,
  onSaved,
}: {
  accountId: number;
  name: string;
  application: MembershipApplication | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [decision, setDecision] = useState<'APPROVED' | 'DISAPPROVED' | ''>('');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!decision) return setError('Please choose Approved or Not approved.');
    if (!date) return setError('Please enter the date of the Board decision.');
    if (decision === 'DISAPPROVED' && !reason.trim()) return setError('Please type the reason the application was not approved.');
    setSaving(true);
    setError('');
    try {
      await api.post(`/accounts/${accountId}/membership-decision`, { decision, boardDecisionDate: date, reference, reason });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const choice = (on: boolean, tone: 'green' | 'gray') =>
    `flex-1 rounded-lg border-2 px-4 py-3 text-lg font-semibold ${
      on ? (tone === 'green' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-600 bg-slate-100 text-slate-900') : 'border-slate-300 bg-white hover:border-slate-400'
    }`;

  return (
    <Modal
      title="Record Board Decision"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Go Back
          </Button>
          <Button variant={decision === 'DISAPPROVED' ? 'danger' : 'success'} onClick={save} disabled={saving || !decision}>
            {saving ? 'Saving…' : decision === 'DISAPPROVED' ? 'Save: Not Approved' : 'Save: Approved'}
          </Button>
        </>
      }
    >
      <p className="mb-4">
        Membership application of <strong>{name}</strong>
        {application && <> · applied {formatDate(application.appliedOn)}</>}.
        <span className="block text-slate-600">Enter what the Board decided in its meeting.</span>
      </p>
      <div className="mb-4 flex gap-3" role="radiogroup" aria-label="Board decision">
        <button type="button" role="radio" aria-checked={decision === 'APPROVED'} className={choice(decision === 'APPROVED', 'green')} onClick={() => setDecision('APPROVED')}>
          ✓ Approved
        </button>
        <button type="button" role="radio" aria-checked={decision === 'DISAPPROVED'} className={choice(decision === 'DISAPPROVED', 'gray')} onClick={() => setDecision('DISAPPROVED')}>
          ✗ Not approved
        </button>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Date of the Board decision">
          <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Resolution or meeting no. (optional)">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Res. No. 12" />
        </Field>
      </div>
      {decision === 'DISAPPROVED' && (
        <Field label="Reason (required)">
          <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      )}
      {decision === 'APPROVED' && (
        <Notice tone="info">The Cashier can then receive the membership fee. The account becomes a Member once it is paid in full.</Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
