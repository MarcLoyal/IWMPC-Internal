import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, peso } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { Button, Loading, Notice } from './ui';

/** What to write on the paper BIR Service Invoice (worked out by the server). */
export interface Guide {
  header: { coopName: string; coopAddress: string; tinLine: string; phoneLine: string; atpNo: string; atpDate: string; seriesFrom?: string; seriesTo?: string };
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

/** Values to copy are shown in blue, like pen on the printed form, so they stand out from the labels. */
const PEN = 'font-semibold text-blue-800';
const money = (v: string | null) => (v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

/** A label with a write-on line, as on the booklet ("Registered Name: ________"). */
function Blank({ label, value, className = '' }: { label: string; value?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 items-end gap-2 ${className}`}>
      <span className="shrink-0 font-serif text-[15px] text-slate-800">{label}</span>
      <span className={`min-h-[1.75rem] min-w-0 flex-1 truncate border-b border-slate-500 px-1 text-lg leading-7 ${PEN}`}>{value}</span>
    </div>
  );
}

const Box = ({ on }: { on: boolean }) => (
  <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center border-2 border-slate-700 text-base font-black leading-none text-blue-800">
    {on ? '✓' : ''}
  </span>
);

const cell = 'border border-slate-600 px-2 py-1';
const amountCell = `${cell} text-right text-lg tabular-nums ${PEN}`;

/** One printed row of the table (A1 to D): label across the two item columns, then quantity, unit price, amount. */
function Row({ label, amount, indent = false, note }: { label: string; amount: string | null; indent?: boolean; note?: string }) {
  return (
    <tr>
      <td colSpan={2} className={`${cell} ${indent ? 'pl-7 font-semibold' : 'font-bold'} whitespace-nowrap`}>
        {label}
        {note && <div className="text-sm font-normal italic text-slate-500">{note}</div>}
      </td>
      <td className={cell} />
      <td className={cell} />
      <td className={amountCell}>{money(amount)}</td>
    </tr>
  );
}

/** The filled-in invoice, laid out like IWMPC's BIR Service Invoice booklet, with the "GUIDE ONLY" watermark. */
export function InvoiceGuideSheet({ guide: g }: { guide: Guide }) {
  const h = g.header;
  const series = h.seriesFrom && h.seriesTo ? `${Number(h.seriesFrom).toLocaleString('en-US')}-${Number(h.seriesTo).toLocaleString('en-US')}` : '';
  return (
    <div className="relative mx-auto max-w-[660px] overflow-hidden border border-slate-400 bg-white px-5 py-5 text-slate-900 shadow-md sm:px-7">
      {/* The watermark: across the whole guide, on top, but it does not block reading or copying. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <span className="-rotate-[30deg] select-none whitespace-nowrap text-[2.4rem] font-black uppercase tracking-wider text-red-600/15 sm:text-[3.4rem]">
          Guide only – not an invoice
        </span>
      </div>
      <span className="sr-only">Guide only – not an invoice.</span>

      {/* Header: the cooperative on the left, the number and SERVICE INVOICE on the right */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="max-w-[380px] text-xl font-black uppercase leading-tight">{h.coopName.replace(/-/g, '\u2011')}</div>
          <div className="text-[15px] leading-snug">{h.coopAddress}</div>
          <div className="text-[15px] leading-snug">{h.tinLine}</div>
          <div className="text-[15px] leading-snug">{h.phoneLine}</div>
        </div>
        <div className="text-right">
          <div className="flex items-baseline justify-end gap-2">
            <span className="text-xl font-black">Nº</span>
            <span className="text-4xl font-semibold tabular-nums tracking-wide text-red-700">{g.number || '—'}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1 text-[15px] font-semibold">
          <label className="flex items-center gap-2">
            <Box on={g.cashSales} /> CASH SALES
          </label>
          <label className="flex items-center gap-2">
            <Box on={g.chargeSales} /> CHARGE SALES
          </label>
        </div>
        <div className="w-[250px] max-w-full space-y-1">
          <div className="text-right">
            <span className="text-base font-black">SERVICE </span>
            <span className="text-2xl font-black">INVOICE</span>
          </div>
          <Blank label="Date:" value={formatDate(g.date)} />
        </div>
      </div>

      {/* The buyer */}
      <div className="mt-3 space-y-1.5">
        <Blank label="Sold to:" />
        <Blank label="Registered Name:" value={g.registeredName} />
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[1.15fr_1fr]">
          <Blank label="TIN:" value={g.tin} />
          <Blank label="Meter No." value={g.meterNo} />
        </div>
        <Blank label="Business Address:" value={g.businessAddress} />
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[1.15fr_1fr]">
          <Blank label="Period Cover From:" value={g.periodFrom} />
          <Blank label="To:" value={g.periodTo} />
        </div>
      </div>

      {/* The table, as printed */}
      <table className="mt-3 w-full table-fixed border-collapse border-2 border-slate-700 text-[15px]">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[22%]" />
          <col className="w-[18%]" />
          <col className="w-[13%]" />
          <col className="w-[25%]" />
        </colgroup>
        <thead className="font-bold">
          <tr>
            <th colSpan={2} className={`${cell} text-center leading-tight`}>
              Item Description/
              <br />
              Nature of Service
            </th>
            <th rowSpan={4} className={`${cell} text-center leading-tight`}>
              Quantity
              <div className="mt-3 text-sm">Cubic Meters Consumed</div>
            </th>
            <th rowSpan={4} className={`${cell} text-center leading-tight`}>
              Unit Price
            </th>
            <th rowSpan={4} className={`${cell} text-center leading-tight tracking-wider`}>
              Amount Due
            </th>
          </tr>
          <tr>
            <th colSpan={2} className={`${cell} text-left`}>
              A. Water Consumption
            </th>
          </tr>
          <tr>
            <th colSpan={2} className={`${cell} text-center`}>
              READINGS
            </th>
          </tr>
          <tr>
            <th className={`${cell} text-center`}>PRESENT</th>
            <th className={`${cell} text-center`}>PREVIOUS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${cell} h-9 text-center text-lg tabular-nums ${PEN}`}>{g.water?.present ?? ''}</td>
            <td className={`${cell} text-center text-lg tabular-nums ${PEN}`}>{g.water?.previous ?? ''}</td>
            <td className={`${cell} text-center text-lg tabular-nums ${PEN}`}>{g.water?.cubicMeters ?? ''}</td>
            <td className={cell} />
            <td className={amountCell}>{money(g.water?.amount ?? null)}</td>
          </tr>
          <Row indent label="A1. Assessment" amount={g.assessment} />
          <Row indent label="A2. Penalty/Surcharge" amount={g.penalty} />
          <Row indent label="A3. Connection/Reconnection" amount={g.connection} />
          <Row label="B. Consumer Store" amount={g.store?.amount ?? null} note={g.store?.items.join('; ')} />
          <Row label="C. Loans Receivable" amount={g.loans} />
          <Row indent label="C1. Interest" amount={g.loanInterest} />
          <Row indent label="C2. Penalty/Surcharge" amount={g.loanPenalty} />
          <Row
            label="D. Others"
            amount={g.othersTotal}
            note={g.others.length > 0 ? g.others.map((o) => { const label = o.label.replace(/^Others?:\s*/i, ''); return g.others.length > 1 ? `${label} ${peso(o.amount)}` : label; }).join('; ') : undefined}
          />
        </tbody>
      </table>

      {/* Received the amount of … and the totals */}
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_290px]">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-[15px]">
            <Box on={false} /> Received the amount of
          </div>
          <div className={`mt-1 border-b border-slate-500 px-1 pb-0.5 text-base leading-snug ${PEN}`}>{g.amountInWords}</div>
          <div className="mt-auto pt-8">
            <div className="border-t border-slate-600 pt-0.5 text-center text-[15px]">Cashier/Collector</div>
          </div>
        </div>
        <table className="w-full border-collapse border-2 border-slate-700 text-[15px]">
          <tbody>
            <tr>
              <td className={`${cell} text-center`}>Total Sales</td>
              <td className={`${amountCell} w-[45%]`}>{money(g.totalSales)}</td>
            </tr>
            <tr>
              <td className={`${cell} text-center leading-tight`}>
                Less: Discount
                <div className="text-[11px]">(SC/PWD/NAAC/MOV/SP)</div>
              </td>
              <td className={amountCell}>{money(g.discount)}</td>
            </tr>
            <tr>
              <td className={`${cell} text-center`}>Less: Withholding Tax</td>
              <td className={amountCell}>{money(g.withholdingTax)}</td>
            </tr>
            <tr>
              <td className={`${cell} text-center font-black leading-tight`}>TOTAL AMOUNT DUE</td>
              <td className={`${amountCell} text-xl font-bold`}>{money(g.totalAmountDue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-center">
        <span className="inline-block rounded-full border border-slate-600 px-3 py-0.5 text-xs font-semibold">&quot;THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAXES&quot;</span>
      </div>
      <div className="mt-2 border-t border-slate-400 pt-1.5 text-xs leading-snug text-slate-700">
        BIR Authority to Print No: {h.atpNo || '—'}
        {h.atpDate && <> · Date Issued: {formatDate(h.atpDate)}</>}
        {series && <> · Approved Series: {series}</>}
      </div>
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
