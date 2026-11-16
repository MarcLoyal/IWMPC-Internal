import { useState } from 'react';
import { formatDate, peso } from '../lib/format';
import { KIND_LABEL, type ProductKind, type Purchase } from '../lib/types';
import { Badge, Card, PrintButton } from './ui';

/** Every Rice & LPG item an account bought, newest first, with yearly totals per item. */
export function PurchasesTab({ purchases }: { purchases: Purchase[] }) {
  const thisYear = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 4);
  const years = Array.from(new Set([thisYear, ...purchases.map((p) => p.date.slice(0, 4))])).sort().reverse();
  const [year, setYear] = useState(years[0]);
  const rows = purchases.filter((p) => p.date.startsWith(year));
  const yearTotal = rows.filter((p) => p.status === 'ACTIVE').reduce((sum, p) => sum + Number(p.amount), 0);
  const kinds = (['RICE', 'LPG', 'OTHER'] as ProductKind[]).filter((k) => rows.some((p) => p.category === k));

  return (
    <Card>
      <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4">
        <label className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Year</span>
          <select className="input w-auto py-2" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <PrintButton />
      </div>
      <div className="hidden px-4 pt-3 text-lg font-bold print:block">{year}</div>

      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-slate-500">No Rice &amp; LPG purchases in {year}.</p>
      ) : (
        <>
          {kinds.map((k) => (
            <KindSection key={k} title={KIND_LABEL[k]} year={year} rows={rows.filter((p) => p.category === k)} />
          ))}
          {kinds.length > 1 && (
            <div className="flex items-baseline justify-between gap-4 border-t-2 border-slate-300 bg-slate-50 px-4 py-3">
              <span className="text-lg font-bold">Total Rice &amp; LPG for {year}</span>
              <span className="text-xl font-bold tabular-nums">{peso(yearTotal)}</span>
            </div>
          )}
          <p className="px-4 py-2 text-sm text-slate-500">Voided sales are listed but not counted.</p>
        </>
      )}
    </Card>
  );
}

/** The purchases of one kind (Rice, or LPG) in one year, with totals per item. */
function KindSection({ title, year, rows }: { title: string; year: string; rows: Purchase[] }) {
  const counted = rows.filter((p) => p.status === 'ACTIVE');
  const totals = new Map<string, { product: string; unit: string; quantity: number; amount: number }>();
  for (const p of counted) {
    const key = `${p.productName}|${p.unitLabel}`;
    const t = totals.get(key) ?? { product: p.productName, unit: p.unitLabel, quantity: 0, amount: 0 };
    totals.set(key, { ...t, quantity: t.quantity + Number(p.quantity), amount: t.amount + Number(p.amount) });
  }
  const total = counted.reduce((sum, p) => sum + Number(p.amount), 0);
  const qty = (n: number) => String(Math.round(n * 100) / 100);

  return (
    <section className="avoid-break border-b border-slate-200">
      <h3 className="bg-brand-50 px-4 py-2 text-lg font-bold text-brand-900">{title}</h3>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[13%]" />
          <col />
          <col className="w-[9%]" />
          <col className="w-[13%]" />
          <col className="w-[14%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th py-2">Date</th>
            <th className="th py-2">Item</th>
            <th className="th py-2 text-right">Qty</th>
            <th className="th py-2 text-right">Price</th>
            <th className="th py-2 text-right">Amount</th>
            <th className="th py-2">OR No.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p, i) => {
            const isVoid = p.status === 'VOID';
            return (
              <tr key={i} className={isVoid ? 'text-slate-400' : ''}>
                <td className="td whitespace-nowrap py-1.5 text-sm">{formatDate(p.date)}</td>
                <td className="td py-1.5">
                  <span className="font-semibold">{p.productName}</span>
                  <span className="block text-xs text-slate-500">{p.unitLabel}</span>
                </td>
                <td className="td py-1.5 text-right tabular-nums">{p.quantity}</td>
                <td className="td py-1.5 text-right tabular-nums">{peso(p.unitPrice)}</td>
                <td className={`td py-1.5 text-right font-bold tabular-nums ${isVoid ? 'line-through' : ''}`}>{peso(p.amount)}</td>
                <td className="td py-1.5">
                  <span className="font-semibold tabular-nums">{p.orNumbers.join(', ')}</span>
                  {isVoid && <Badge tone="gray" small>VOID</Badge>}
                  {!isVoid && p.isCredit && Number(p.balance) > 0 && (
                    <Badge tone="yellow" small>
                      Credit · {peso(p.balance)} owed
                    </Badge>
                  )}
                  {!isVoid && p.isCredit && Number(p.balance) === 0 && <Badge tone="green" small>Credit · paid</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bg-slate-50 px-4 py-2">
        <table className="w-full max-w-xl">
          <tbody>
            {[...totals.values()].map((t) => (
              <tr key={`${t.product}|${t.unit}`}>
                <td className="py-0.5 font-semibold">{t.product}</td>
                <td className="py-0.5 text-slate-600">{t.unit}</td>
                <td className="py-0.5 text-right tabular-nums">{qty(t.quantity)}</td>
                <td className="py-0.5 text-right font-semibold tabular-nums">{peso(t.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300">
              <td className="pt-1 font-bold" colSpan={3}>
                {title} total for {year}
              </td>
              <td className="pt-1 text-right font-bold tabular-nums">{peso(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
