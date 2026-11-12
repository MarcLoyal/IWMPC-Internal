import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PAYMENT_TYPE, formatDateTime, formatLongDate, peso } from '../lib/format';
import type { DailyReport as Report, Payment } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { PaymentDetails } from '../components/PaymentDetails';
import { Card, Field, Loading, Notice, PageHeader, PrintButton } from '../components/ui';

export function DailyReport() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? '';
  const { data, error, loading, reload } = useLoad<Report>(`/reports/daily${date ? `?date=${date}` : ''}`);
  const [open, setOpen] = useState<Payment | null>(null);

  return (
    <>
      <div className="mb-4 hidden text-center print:block">
        <img src="/logo.png" alt="" className="mx-auto mb-1 h-16 w-16" />
        <div className="text-lg font-bold">{data?.coop.name}</div>
        {data?.coop.address && <div className="text-sm">{data.coop.address}</div>}
        {data?.coop.cdaNo && <div className="text-sm">CDA Reg. No. {data.coop.cdaNo}</div>}
      </div>
      <PageHeader title="Daily Collection Report" subtitle={data ? formatLongDate(data.date) : undefined} back={{ to: '/cashier', label: 'Back to Cashier' }}>
        <Field label="Date">
          <input className="input" type="date" value={date || data?.date || ''} onChange={(e) => setParams(e.target.value ? { date: e.target.value } : {}, { replace: true })} />
        </Field>
        <div className="self-end">
          <PrintButton />
        </div>
      </PageHeader>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Loading what="report" />}

      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          {data.orGaps.length > 0 && (
            <Notice tone="warning" className="mb-5">
              <div className="font-bold">⚠ Some OR numbers are missing for this day. Please check the receipt booklet.</div>
              <ul className="mt-1 list-disc pl-6 font-normal">
                {data.orGaps.map((g) => (
                  <li key={g.after}>
                    Between {g.after} and {g.before}:{' '}
                    <strong>
                      {g.missing.join(', ')}
                      {g.missingCount > g.missing.length && ` … (${g.missingCount} numbers in all)`}
                    </strong>
                  </li>
                ))}
              </ul>
            </Notice>
          )}

          <div className="mb-5 grid gap-4 sm:grid-cols-[1fr_2fr] print:grid-cols-[1fr_2fr]">
            <Card className="avoid-break p-5">
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Grand Total</div>
              <div className="mt-1 text-4xl font-bold tabular-nums">{peso(data.grandTotal)}</div>
              <div className="mt-1 text-slate-600">
                {data.count} {data.count === 1 ? 'payment' : 'payments'}
                {data.voidedCount > 0 && ` · ${data.voidedCount} voided (not counted)`}
              </div>
            </Card>
            <Card className="avoid-break overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Payment Type</th>
                    <th className="th text-right">Payments</th>
                    <th className="th text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.totals.map((t) => (
                    <tr key={t.type}>
                      <td className="td font-semibold">{PAYMENT_TYPE[t.type]}</td>
                      <td className="td text-right tabular-nums">{t.count}</td>
                      <td className="td text-right font-semibold tabular-nums">{peso(t.total)}</td>
                    </tr>
                  ))}
                  {data.totals.length === 0 && (
                    <tr>
                      <td className="td text-slate-500" colSpan={3}>
                        No payments on this day.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="overflow-hidden">
            {data.payments.length === 0 ? (
              <p className="px-6 py-12 text-center text-slate-500">No payments were recorded on this day.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] print:min-w-0">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="th">OR No.</th>
                      <th className="th">Name</th>
                      <th className="th">Type</th>
                      <th className="th">Recorded by</th>
                      <th className="th text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.payments.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => setOpen(p)}
                        onKeyDown={(e) => e.key === 'Enter' && setOpen(p)}
                        tabIndex={0}
                        className={`cursor-pointer hover:bg-brand-50 ${p.status === 'VOID' ? 'text-slate-400' : ''}`}
                      >
                        <td className="td font-semibold tabular-nums">{p.orNumber}</td>
                        <td className="td">
                          {p.accountName} <span className="whitespace-nowrap text-sm text-slate-500">({p.accountNumber})</span>
                        </td>
                        <td className="td">
                          {PAYMENT_TYPE[p.type]}
                          {p.description && <span className="block text-sm text-slate-500">{p.description}</span>}
                          {p.status === 'VOID' && <span className="block text-sm font-semibold text-red-700">VOID: {p.voidReason}</span>}
                        </td>
                        <td className="td whitespace-nowrap">{p.createdBy}</td>
                        <td className={`td text-right text-lg font-semibold tabular-nums ${p.status === 'VOID' ? 'line-through' : ''}`}>{peso(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                    <tr>
                      <td className="td font-bold" colSpan={4}>
                        Grand Total
                      </td>
                      <td className="td text-right text-lg font-bold tabular-nums">{peso(data.grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          <div className="mt-10 hidden grid-cols-2 gap-12 text-sm print:grid">
            <div>
              <div className="mt-10 border-t border-slate-600 pt-1">Prepared by (Cashier)</div>
            </div>
            <div>
              <div className="mt-10 border-t border-slate-600 pt-1">Received by (Bookkeeper)</div>
            </div>
            <div className="col-span-2 text-slate-600">
              Printed {formatDateTime(new Date().toISOString())} by {user?.name}
            </div>
          </div>
        </div>
      )}

      {open && (
        <PaymentDetails
          payment={open}
          onClose={() => setOpen(null)}
          onChanged={(updated) => {
            setOpen(updated);
            void reload();
          }}
        />
      )}
    </>
  );
}
