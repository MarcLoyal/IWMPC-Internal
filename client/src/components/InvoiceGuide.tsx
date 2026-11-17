import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, peso } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { Button, Loading, Notice } from './ui';

/** What to write on the paper BIR Service Invoice (worked out by the server). */
export interface Guide {
  header: { coopName: string; coopAddress: string; tinLine: string; phoneLine: string; atpNo: string; atpDate: string };
  number: string;
  date: string;
  cashSales: boolean;
  chargeSales: boolean;
  cancelled: boolean;
  cancelReason: string | null;
  registeredName: string;
  tin: string;
  meterNo: string;
  businessAddress: string;
  periodFrom: string;
  periodTo: string;
  water: { present: number; previous: number; cubicMeters: number; amount: string | null } | null;
  assessment: string | null;
  penalty: string | null;
  connection: string | null;
  store: { amount: string; items: string[] } | null;
  loans: string | null;
  loanInterest: string | null;
  loanPenalty: string | null;
  others: { label: string; amount: string }[];
  othersTotal: string | null;
  totalSales: string;
  discount: string | null;
  withholdingTax: string | null;
  totalAmountDue: string;
  amountInWords: string;
}

const Amount = ({ value }: { value: string | null }) => (value ? <span className="text-xl font-bold tabular-nums text-slate-900">{peso(value)}</span> : null);

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-slate-300 py-1">
      <span className="shrink-0 text-sm text-slate-600">{label}</span>
      <span className="min-w-0 flex-1 text-lg font-bold text-slate-900">{children || ' '}</span>
    </div>
  );
}

function Line({ code, label, qty, amount, sub, bold = false }: { code: string; label: string; qty?: ReactNode; amount: string | null; sub?: ReactNode; bold?: boolean }) {
  return (
    <tr className="border-b border-slate-300 align-top">
      <td className={`px-2 py-1.5 ${code.length > 1 ? 'pl-6' : ''}`}>
        <span className={bold ? 'font-bold' : 'font-semibold'}>
          {code}. {label}
        </span>
        {sub && <div className="text-sm text-slate-600">{sub}</div>}
      </td>
      <td className="border-l border-slate-300 px-2 py-1.5 text-center text-xl font-bold tabular-nums">{qty}</td>
      <td className="border-l border-slate-300 px-2 py-1.5" />
      <td className="border-l border-slate-300 px-2 py-1.5 text-right">
        <Amount value={amount} />
      </td>
    </tr>
  );
}

/** The filled-in invoice, laid out like IWMPC's booklet, with the "GUIDE ONLY" watermark. */
export function InvoiceGuideSheet({ guide: g }: { guide: Guide }) {
  return (
    <div className="relative overflow-hidden rounded-lg border-2 border-slate-400 bg-white p-4 sm:p-5">
      {/* The watermark: across the whole guide, on top, but it does not block reading or copying. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <span className="-rotate-[28deg] select-none whitespace-nowrap text-[2.6rem] font-black uppercase tracking-wider text-red-600/15 sm:text-6xl">
          Guide only – not an invoice
        </span>
      </div>
      <span className="sr-only">Guide only – not an invoice.</span>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black leading-tight">{g.header.coopName}</div>
          <div className="text-sm">{g.header.coopAddress}</div>
          <div className="text-sm">{g.header.tinLine}</div>
          <div className="text-sm">{g.header.phoneLine}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-600">No.</div>
          <div className="text-3xl font-black tabular-nums text-slate-900">{g.number || '—'}</div>
          <div className="text-lg font-black">SERVICE INVOICE</div>
          <div className="text-sm text-slate-600">
            Date: <span className="text-lg font-bold text-slate-900">{formatDate(g.date)}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex gap-6 text-base font-semibold">
        <span>{g.cashSales ? '☒' : '☐'} CASH SALES</span>
        <span>{g.chargeSales ? '☒' : '☐'} CHARGE SALES</span>
      </div>

      <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldRow label="Registered Name:">{g.registeredName}</FieldRow>
        </div>
        <FieldRow label="TIN:">{g.tin}</FieldRow>
        <FieldRow label="Meter No.:">{g.meterNo}</FieldRow>
        <div className="sm:col-span-2">
          <FieldRow label="Business Address:">{g.businessAddress}</FieldRow>
        </div>
        <FieldRow label="Period Cover From:">{g.periodFrom}</FieldRow>
        <FieldRow label="To:">{g.periodTo}</FieldRow>
      </div>

      <table className="mt-3 w-full table-fixed border-2 border-slate-400 text-base">
        <colgroup>
          <col />
          <col className="w-[22%]" />
          <col className="w-[13%]" />
          <col className="w-[22%]" />
        </colgroup>
        <thead className="border-b-2 border-slate-400 bg-slate-50 text-xs font-bold uppercase">
          <tr>
            <th className="px-2 py-1.5 text-left">Item Description / Nature of Service</th>
            <th className="border-l border-slate-300 px-2 py-1.5">Quantity</th>
            <th className="border-l border-slate-300 px-2 py-1.5">Unit Price</th>
            <th className="border-l border-slate-300 px-2 py-1.5 text-right">Amount Due</th>
          </tr>
        </thead>
        <tbody>
          <Line
            code="A"
            label="Water Consumption"
            bold
            qty={g.water ? g.water.cubicMeters : undefined}
            amount={g.water?.amount ?? null}
            sub={
              g.water ? (
                <span className="text-base">
                  Readings: Present <strong className="text-lg tabular-nums text-slate-900">{g.water.present}</strong> · Previous{' '}
                  <strong className="text-lg tabular-nums text-slate-900">{g.water.previous}</strong> · Quantity = cubic meters consumed
                </span>
              ) : undefined
            }
          />
          <Line code="A1" label="Assessment" amount={g.assessment} />
          <Line code="A2" label="Penalty/Surcharge" amount={g.penalty} />
          <Line code="A3" label="Connection/Reconnection" amount={g.connection} />
          <Line code="B" label="Consumer Store" bold amount={g.store?.amount ?? null} sub={g.store?.items.join('; ')} />
          <Line code="C" label="Loans Receivable" bold amount={g.loans} />
          <Line code="C1" label="Interest" amount={g.loanInterest} />
          <Line code="C2" label="Penalty/Surcharge" amount={g.loanPenalty} />
          <Line code="D" label="Others" bold amount={g.othersTotal} sub={g.others.length > 0 ? g.others.map((o) => `${o.label} ${peso(o.amount)}`).join('; ') : undefined} />
        </tbody>
      </table>

      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_minmax(0,280px)]">
        <div className="rounded border border-slate-300 p-2">
          <div className="text-sm font-semibold text-slate-600">☐ Received the amount of</div>
          <div className="text-lg font-bold">{g.amountInWords}</div>
          <div className="text-xl font-black tabular-nums">({peso(g.totalAmountDue)})</div>
          <div className="mt-6 border-t border-slate-500 pt-1 text-center text-sm text-slate-600">Cashier/Collector</div>
        </div>
        <table className="w-full border-2 border-slate-400 text-base">
          <tbody>
            <tr className="border-b border-slate-300">
              <td className="px-2 py-1.5 font-semibold">Total Sales</td>
              <td className="px-2 py-1.5 text-right">
                <Amount value={g.totalSales} />
              </td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="px-2 py-1.5 text-sm">Less: Discount</td>
              <td className="px-2 py-1.5 text-right">
                <Amount value={g.discount} />
              </td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="px-2 py-1.5 text-sm">Less: Withholding Tax</td>
              <td className="px-2 py-1.5 text-right">
                <Amount value={g.withholdingTax} />
              </td>
            </tr>
            <tr className="bg-slate-50">
              <td className="px-2 py-2 font-black">TOTAL AMOUNT DUE</td>
              <td className="px-2 py-2 text-right text-2xl font-black tabular-nums">{peso(g.totalAmountDue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {(g.header.atpNo || g.header.atpDate) && (
        <div className="mt-2 text-xs text-slate-500">
          ATP No. {g.header.atpNo}
          {g.header.atpDate && ` · Date issued ${formatDate(g.header.atpDate)}`}
        </div>
      )}
    </div>
  );
}

/**
 * The guide in a pop-up over the page. It has no print or download button, and printing the page
 * while it is open prints only a short message (see index.css: body.invoice-guide-open).
 */
export function InvoiceGuideModal({
  title,
  guide,
  loading,
  error,
  top,
  footer,
  onClose,
}: {
  title: string;
  guide: Guide | null;
  loading?: boolean;
  error?: string;
  top?: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('invoice-guide-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('invoice-guide-open');
    };
  }, [onClose]);

  return createPortal(
    <>
      <div data-invoice-guide className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-4">
        <div role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-3xl rounded-xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="text-xl font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100">
              ×
            </button>
          </div>
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <Notice tone="info">
              <span className="font-bold">Copy these values to the BIR Service Invoice booklet.</span> This screen is only a guide and cannot be printed.
            </Notice>
            {top}
            {loading && !guide && <Loading what="invoice guide" />}
            {error && <Notice tone="error">{error}</Notice>}
            {guide?.cancelled && (
              <Notice tone="error">
                <span className="font-bold">Invoice No. {guide.number} was CANCELLED.</span> {guide.cancelReason && `Reason: ${guide.cancelReason}`}
              </Notice>
            )}
            {guide && <InvoiceGuideSheet guide={guide} />}
          </div>
          <div className="flex flex-wrap justify-end gap-3 rounded-b-xl border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>
        </div>
      </div>
      <div className="guide-print-message">This guide cannot be printed. Use the BIR Service Invoice booklet.</div>
    </>,
    document.body,
  );
}

/** Reopens the guide of a saved invoice ("View invoice guide"). */
export function SavedInvoiceGuide({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const { data, error, loading } = useLoad<{ guide: Guide }>(`/invoices/${invoiceId}/guide`);
  return (
    <InvoiceGuideModal
      title={data ? `Invoice guide · No. ${data.guide.number}` : 'Invoice guide'}
      guide={data?.guide ?? null}
      loading={loading}
      error={error}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    />
  );
}

/**
 * A saved invoice's guide shown inside another pop-up (the "Invoice" tab of Open bill).
 * On paper it shows only the "cannot be printed" message.
 */
export function InvoiceGuideInline({ invoiceId }: { invoiceId: number }) {
  const { data, error, loading } = useLoad<{ guide: Guide }>(`/invoices/${invoiceId}/guide`);
  const guide = data?.guide;
  return (
    <>
      <div className="space-y-3 print:hidden">
        <Notice tone="info">
          <span className="font-bold">Copy these values to the BIR Service Invoice booklet.</span> This screen is only a guide and cannot be printed.
        </Notice>
        {loading && !guide && <Loading what="invoice guide" />}
        {error && <Notice tone="error">{error}</Notice>}
        {guide?.cancelled && (
          <Notice tone="error">
            <span className="font-bold">Invoice No. {guide.number} was CANCELLED.</span> {guide.cancelReason && `Reason: ${guide.cancelReason}`}
          </Notice>
        )}
        {guide && <InvoiceGuideSheet guide={guide} />}
      </div>
      <p className="hidden p-8 text-center text-xl font-bold print:block">This guide cannot be printed. Use the BIR Service Invoice booklet.</p>
    </>
  );
}
