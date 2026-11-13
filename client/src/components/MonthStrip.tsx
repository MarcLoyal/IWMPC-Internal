import { useState } from 'react';
import { formatDate, peso } from '../lib/format';
import type { WaterSummary } from '../lib/types';
import { monthShort, periodLabel } from '../lib/water';

type MonthStatus = WaterSummary['months'][number]['status'];

/** One meaning per color: green = paid, yellow = due soon, red = overdue only, grey = nothing to act on. */
export const MONTH_BOX: Record<MonthStatus, { box: string; label: string }> = {
  PAID: { box: 'bg-emerald-600 text-white', label: 'Paid' },
  UNPAID: { box: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-400', label: 'Not yet due' },
  DUE_SOON: { box: 'bg-amber-400 text-amber-950', label: 'Due soon' },
  OVERDUE: { box: 'bg-red-600 text-white', label: 'Overdue' },
  NONE: { box: 'bg-slate-200 text-slate-400', label: 'No bill' },
};

/** The key shown above the table. */
export function MonthLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600" aria-label="What the month colors mean">
      {(['PAID', 'UNPAID', 'DUE_SOON', 'OVERDUE', 'NONE'] as MonthStatus[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded-sm ${MONTH_BOX[s].box}`} aria-hidden />
          {MONTH_BOX[s].label}
        </li>
      ))}
    </ul>
  );
}

/** Twelve small month boxes. Hover, focus or tap a box for the month, amount, status and date paid. */
export function MonthStrip({ months, previousUnpaid }: { months: WaterSummary['months']; previousUnpaid: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <div className="flex gap-0.5" onMouseLeave={() => setOpen(null)}>
        {months.map((m, i) => {
          const info = MONTH_BOX[m.status];
          const summary =
            m.status === 'NONE'
              ? `${periodLabel(m.period)}: no bill`
              : `${periodLabel(m.period)}: ${peso(m.amount ?? 0)}, ${info.label}${m.datePaid ? `, paid ${formatDate(m.datePaid)}` : ''}`;
          return (
            <span key={m.period} className="relative">
              <button
                type="button"
                aria-label={summary}
                onMouseEnter={() => setOpen(i)}
                onFocus={() => setOpen(i)}
                onBlur={() => setOpen(null)}
                onClick={() => setOpen(open === i ? null : i)}
                className={`block h-[18px] w-4 rounded-sm text-[10px] font-bold leading-[18px] ${info.box}`}
              >
                {monthShort(m.period)[0]}
              </button>
              {open === i && (
                <span
                  role="tooltip"
                  className={`pointer-events-none absolute bottom-full z-20 mb-1.5 w-max rounded-lg bg-slate-900 px-3 py-2 text-left text-sm leading-snug text-white shadow-lg ${
                    i < 6 ? 'left-0' : 'right-0'
                  }`}
                >
                  <span className="block font-bold">{periodLabel(m.period)}</span>
                  {m.status === 'NONE' ? (
                    <span className="block">No bill</span>
                  ) : (
                    <>
                      <span className="block tabular-nums">{peso(m.amount ?? 0)}</span>
                      <span className="block">{info.label}</span>
                      {m.datePaid && <span className="block">Paid {formatDate(m.datePaid)}</span>}
                    </>
                  )}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {Number(previousUnpaid) > 0 && (
        <div className="mt-0.5 text-xs font-semibold text-red-700">Previous balance: {peso(previousUnpaid)}</div>
      )}
    </div>
  );
}
