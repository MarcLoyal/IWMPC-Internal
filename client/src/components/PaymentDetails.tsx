import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAYMENT_TYPE, formatDate, formatDateTime, peso } from '../lib/format';
import type { Payment } from '../lib/types';
import { periodLabel } from '../lib/water';
import { Badge, Button, Detail, Field, Modal, Notice } from './ui';

export function PaymentStatusBadge({ payment }: { payment: Payment }) {
  return payment.status === 'VOID' ? <Badge tone="red">VOID</Badge> : <Badge tone="green">Paid</Badge>;
}

/** Full details of one payment. Admins can void it here, with a reason. */
export function PaymentDetails({
  payment,
  onClose,
  onChanged,
}: {
  payment: Payment;
  onClose: () => void;
  onChanged: (updated: Payment) => void;
}) {
  const { can } = useAuth();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function confirmVoid() {
    setSaving(true);
    setError('');
    try {
      const updated = await api.post<Payment>(`/payments/${payment.id}/void`, { reason });
      onChanged({ ...payment, ...updated });
      setVoiding(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const isVoid = payment.status === 'VOID';

  return (
    <Modal
      title="Payment Details"
      onClose={onClose}
      footer={
        voiding ? (
          <>
            <Button onClick={() => setVoiding(false)} disabled={saving}>
              Go Back
            </Button>
            <Button variant="danger" onClick={confirmVoid} disabled={saving || !reason.trim()}>
              {saving ? 'Voiding…' : 'Yes, Void This Payment'}
            </Button>
          </>
        ) : (
          <>
            {can('ADMIN') && !isVoid && (
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Void Payment
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </>
        )
      }
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className={`text-3xl font-bold tabular-nums ${isVoid ? 'text-slate-400 line-through' : ''}`}>{peso(payment.amount)}</div>
        <PaymentStatusBadge payment={payment} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Detail label="OR Number">
          <span className="font-semibold tabular-nums">{payment.orNumber}</span>
        </Detail>
        <Detail label="Date">{formatDate(payment.paymentDate)}</Detail>
        <Detail label="Payment Type">
          {PAYMENT_TYPE[payment.type]}
          {payment.waterBillPeriod && <span className="block text-slate-600">for {periodLabel(payment.waterBillPeriod)}</span>}
        </Detail>
        <Detail label="Recorded by">{payment.createdBy}</Detail>
        {payment.accountName && (
          <Detail label="Account">
            <Link to={`/accounts/${payment.accountId}`} className="font-semibold text-brand-700 hover:underline" onClick={onClose}>
              {payment.accountName}
            </Link>{' '}
            <span className="text-slate-500">({payment.accountNumber})</span>
          </Detail>
        )}
        <Detail label="Recorded on">{formatDateTime(payment.createdAt)}</Detail>
        {payment.description && (
          <div className="col-span-2">
            <Detail label="Description">{payment.description}</Detail>
          </div>
        )}
      </dl>

      {isVoid && (
        <Notice tone="error" className="mt-5">
          <div className="font-bold">This payment was voided.</div>
          <div className="mt-1 font-normal">Reason: {payment.voidReason}</div>
          <div className="font-normal">
            By {payment.voidedBy ?? '—'} on {formatDateTime(payment.voidedAt)}
          </div>
        </Notice>
      )}

      {voiding && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 font-semibold text-red-900">
            Voiding cancels this payment. It stays in the records marked VOID, with its OR number.
            {payment.type === 'MEMBERSHIP_FEE' && ' The account will go back to Non-member.'}
          </p>
          <Field label="Reason for voiding (required)">
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </div>
      )}
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
