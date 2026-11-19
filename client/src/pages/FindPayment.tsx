import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { PAYMENT_TYPE, formatDate, peso } from '../lib/format';
import type { Payment } from '../lib/types';
import { PaymentDetails, PaymentStatusBadge } from '../components/PaymentDetails';
import { SavedInvoiceGuide } from '../components/InvoiceGuide';
import { Button, Card, Field, Notice, PageHeader, buttonClass } from '../components/ui';

export function FindPayment() {
  const [or, setOr] = useState('');
  const [searched, setSearched] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!or.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.get<{ payment: Payment | null }>(`/payments?or=${encodeURIComponent(or.trim())}`);
      setPayment(res.payment);
      setSearched(or.trim().toUpperCase());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Find by Invoice No." back={{ to: '/cashier', label: 'Back to Cashier' }} />
      <Card className="max-w-2xl p-6">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field label="Invoice No." className="min-w-[200px] flex-1">
            <input className="input text-xl font-semibold tabular-nums" value={or} onChange={(e) => setOr(e.target.value)} autoFocus />
          </Field>
          <button type="submit" disabled={busy || !or.trim()} className={buttonClass('primary')}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && (
          <Notice tone="error" className="mt-5">
            {error}
          </Notice>
        )}
        {searched && !payment && !error && (
          <Notice tone="warning" className="mt-5">
            No payment is recorded with Invoice No. {searched}.
          </Notice>
        )}
        {payment && (
          <div className="mt-5 rounded-lg border border-slate-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xl font-bold">
                  {payment.accountName}
                  {payment.walkIn && <span className="ml-2 text-base font-normal text-slate-500">(walk-in)</span>}
                </div>
                <div className="text-slate-600">
                  {PAYMENT_TYPE[payment.type]} · {formatDate(payment.paymentDate)} · Invoice No. {payment.orNumber}
                </div>
              </div>
              <PaymentStatusBadge payment={payment} />
            </div>
            <div className={`mt-3 text-3xl font-bold tabular-nums ${payment.status === 'VOID' ? 'text-slate-400 line-through' : ''}`}>{peso(payment.amount)}</div>
            <div className="mt-4 flex flex-wrap gap-3">
              {payment.invoiceId && (
                <Button variant="primary" onClick={() => setGuide(true)}>
                  View Invoice Guide
                </Button>
              )}
              <Button onClick={() => setOpen(true)}>Open Payment Details</Button>
            </div>
          </div>
        )}
      </Card>
      {guide && payment?.invoiceId && <SavedInvoiceGuide invoiceId={payment.invoiceId} onClose={() => setGuide(false)} />}
      {open && payment && <PaymentDetails payment={payment} onClose={() => setOpen(false)} onChanged={setPayment} />}
    </>
  );
}
