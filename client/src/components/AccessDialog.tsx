import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatDateTime, ROLE } from '../lib/format';
import type { AccessGrant, Work } from '../lib/types';
import type { UserRow, WorkList } from '../pages/Users';
import { Button, Field, Modal, Notice } from './ui';

/** Today in the Philippines, YYYY-MM-DD, for the earliest end date allowed. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

/** Admin: give or remove extra work for one Cashier or Staff user, on request. */
export function AccessDialog({ user, work, onClose, onChanged }: { user: UserRow; work: WorkList; onClose: () => void; onChanged: () => void }) {
  const open = user.grants.filter((g) => !g.removedAt);
  const past = user.grants.filter((g) => g.removedAt);
  const extra = work.filter((w) => !user.roleWork.includes(w.key) && !user.neverWork.includes(w.key));
  const never = work.filter((w) => user.neverWork.includes(w.key));
  const included = work.filter((w) => user.roleWork.includes(w.key));
  const [showPast, setShowPast] = useState(false);

  return (
    <Modal title={`Extra access for ${user.name}`} onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      <p className="text-slate-700">
        As {ROLE[user.role]}, {user.name} can already: <strong>{included.map((w) => w.label).join('; ') || 'view only'}</strong>.
      </p>
      <p className="mt-2 text-slate-600">
        Turn on extra work only when someone asks for it. Each change takes effect at once and is kept in the Audit Log. Voiding, cancelling, prices,
        rates, settings and users stay Admin-only.
      </p>

      {never.length > 0 && (
        <p className="mt-2 text-slate-600">
          To keep duties apart, a {ROLE[user.role]} can never be given: {never.map((w) => w.label).join('; ')}.
        </p>
      )}

      <div className="mt-5 space-y-3">
        {extra.map((w) => (
          <WorkRow key={w.key} userId={user.id} work={w.key} label={w.label} grant={open.find((g) => g.work === w.key) ?? null} onChanged={onChanged} />
        ))}
      </div>

      {past.length > 0 && (
        <div className="mt-5">
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
            {showPast ? 'Hide earlier extra access' : `Show earlier extra access (${past.length})`}
          </button>
          {showPast && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {past.map((g) => (
                <li key={g.id} className="px-4 py-3 text-slate-700">
                  <div className="font-semibold text-slate-900">{g.label}</div>
                  <div>
                    {formatDate(g.grantedAt)} to {formatDate(g.removedAt)} · given by {g.grantedBy}, requested by {g.requestedBy}
                  </div>
                  <div className="text-sm">
                    Reason: {g.reason}
                    {' · '}
                    {g.removedBy ? `Removed by ${g.removedBy}${g.removeReason ? `: ${g.removeReason}` : ''}` : g.removeReason}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

function WorkRow({ userId, work, label, grant, onChanged }: { userId: number; work: Work; label: string; grant: AccessGrant | null; onChanged: () => void }) {
  const [form, setForm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [requestedBy, setRequestedBy] = useState('');
  const [reason, setReason] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // On only once the access is saved, so the switch never shows access that was not given.
  const on = !!grant;

  async function give() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/users/${userId}/access`, { work, requestedBy, reason, endsOn });
      setForm(false);
      setRequestedBy('');
      setReason('');
      setEndsOn('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!grant) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/users/${userId}/access/${grant.id}/remove`, { reason: removeReason });
      setRemoving(false);
      setRemoveReason('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    setError('');
    if (grant) setRemoving((r) => !r);
    else setForm((f) => !f);
  }

  return (
    <div className={`rounded-lg border-2 p-4 ${grant ? 'border-amber-400 bg-amber-50/50' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-4">
        <span id={`work-${work}`} className="text-lg font-semibold text-slate-900">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={!!grant}
          aria-labelledby={`work-${work}`}
          onClick={toggle}
          disabled={busy}
          className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand-700' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} />
          <span className="sr-only">{grant ? 'On' : 'Off'}</span>
        </button>
      </div>

      {grant && (
        <div className="mt-2 text-slate-700">
          <div>
            <strong>On</strong> {grant.endsOn ? `until the end of ${formatDate(grant.endsOn)}` : 'with no end date'} · given by {grant.grantedBy} on{' '}
            {formatDateTime(grant.grantedAt)}
          </div>
          <div>
            Requested by <strong>{grant.requestedBy}</strong> · {grant.reason}
          </div>
        </div>
      )}

      {form && !grant && (
        <div className="mt-4 space-y-3">
          <Field label="Who asked for this access? (required)">
            <input className="input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="e.g. Manager Reyes" autoFocus />
          </Field>
          <Field label="Reason (required)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Meter reader on leave until Dec 1" />
          </Field>
          <Field label="Last day (optional)" hint="The access turns itself off after this day. Leave blank to keep it until you remove it.">
            <input className="input" type="date" min={today()} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={give} disabled={busy || !requestedBy.trim() || !reason.trim()}>
              {busy ? 'Saving…' : 'Give access'}
            </Button>
            <Button onClick={() => setForm(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {removing && grant && (
        <div className="mt-4 space-y-3">
          <Field label="Reason for removing (optional)">
            <input className="input" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="e.g. Meter reader is back" autoFocus />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? 'Removing…' : 'Remove access'}
            </Button>
            <Button onClick={() => setRemoving(false)} disabled={busy}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </div>
  );
}
