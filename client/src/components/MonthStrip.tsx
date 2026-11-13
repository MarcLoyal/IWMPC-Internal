import { useState } from 'react';
import { formatDate, peso } from '../lib/format';
import type { WaterSummary } from '../lib/types';
import { monthShort, periodLabel } from '../lib/water';

const BOX = {
  PAID: 'bg-emerald-600 text-white',
  UNPAID: 'bg-red-600 text-white',
  NONE: 'bg-slate-200 text-slate-500',
} as const;

function describe(m: WaterSummary['months'][number]): string {
  if (m.status === 'NONE') return `${periodLabel(m.period)}: no bill`;
  const amount = peso(m.amount ?? 0);
  return m.status === 'PAID'
    ? `${periodLabel(m.period)}: ${amount}, paid ${formatDate(m.datePaid)}`
    : `${periodLabel(m.period)}: ${amount}, not paid`;
}

/** Twelve small month boxes: green = paid, red = unpaid, gray = no bill. Hover or tap for details. */
export function MonthStrip({ months, previousUnpaid }: { months: WaterSummary['months']; previousUnpaid: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <div className="flex gap-[3px]">
        {months.map((m, i) => (
          <button
            key={m.period}
            type="button"
            title={describe(m)}
            aria-label={describe(m)}
            onClick={() => setOpen(open === i ? null : i)}
            className={`h-6 w-5 shrink-0 rounded text-[11px] font-bold leading-6 ${BOX[m.status]} ${open === i ? 'ring-2 ring-brand-700 ring-offset-1' : ''}`}
          >
            {monthShort(m.period)[0]}
          </button>
        ))}
      </div>
      {open !== null && <div className="mt-1 text-sm font-medium text-slate-700">{describe(months[open])}</div>}
      {Number(previousUnpaid) > 0 && (
        <div className="mt-1 text-sm font-semibold text-red-700">Previous balance: {peso(previousUnpaid)}</div>
      )}
    </div>
  );
}
