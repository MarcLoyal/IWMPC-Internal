import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, peso } from '../lib/format';
import type { Connection, WaterBill } from '../lib/types';
import { BILL_STATUS, RATE_CLASS, monthShort } from '../lib/water';
import { Badge, Card } from './ui';

/**
 * IWMPC's paper Customer Card for one connection: a row per month (December at the top,
 * January at the bottom) with the reading, cu.m used, amount, and O.R. number.
 */
export function CustomerCard({ name, connection, bills }: { name: string; connection: Connection; bills: WaterBill[] }) {
  const thisYear = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 4);
  const years = Array.from(new Set([thisYear, ...bills.map((b) => b.period.slice(0, 4))])).sort().reverse();
  const [year, setYear] = useState(years[0]);
  const byPeriod = new Map(bills.map((b) => [b.period, b]));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(12 - i).padStart(2, '0')}`);
  const yearBills = months.map((m) => byPeriod.get(m)).filter((b): b is WaterBill => !!b);
  const sum = (pick: (b: WaterBill) => number) => yearBills.reduce((total, b) => total + pick(b), 0);

  return (
    <Card className="avoid-break overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Card</div>
          <div className="text-xl font-bold">{name}</div>
          <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
            <div>
              <dt className="inline text-slate-500">Date installed: </dt>
              <dd className="inline font-semibold">{formatDate(connection.installationDate)}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Meter No.: </dt>
              <dd className="inline font-semibold tabular-nums">
                {[connection.meterName, connection.meterSerial && `# ${connection.meterSerial}`].filter(Boolean).join(' ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Rate: </dt>
              <dd className="inline font-semibold">{RATE_CLASS[connection.rateClass] ?? connection.rateClass}</dd>
            </div>
          </dl>
        </div>
        <label className="no-print flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Year</span>
          <select className="input w-auto" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <div className="hidden text-lg font-bold print:block">{year}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] print:min-w-0">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th">Month</th>
              <th className="th">Date read</th>
              <th className="th text-right">Reading</th>
              <th className="th text-right">Cu.M</th>
              <th className="th text-right">Amount</th>
              <th className="th">O.R. No.</th>
              <th className="th">Date paid</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {months.map((period) => {
              const b = byPeriod.get(period);
              if (!b) {
                return (
                  <tr key={period} className="text-slate-400">
                    <td className="td py-2 font-semibold uppercase">{monthShort(period)}.</td>
                    <td className="td py-2" colSpan={7} />
                  </tr>
                );
              }
              const status = BILL_STATUS[b.status];
              return (
                <tr key={period}>
                  <td className="td py-2 font-semibold uppercase">{monthShort(period)}.</td>
                  <td className="td whitespace-nowrap py-2">{formatDate(b.readDate)}</td>
                  <td className="td py-2 text-right tabular-nums">{b.currentReading}</td>
                  <td className="td py-2 text-right tabular-nums">{b.cubicMeters}</td>
                  <td className="td py-2 text-right">
                    <span className="text-lg font-semibold tabular-nums">{peso(b.amount)}</span>
                    {Number(b.penalty) > 0 && (
                      <span className="block text-sm tabular-nums text-red-700">+ {peso(b.penalty)} penalty</span>
                    )}
                  </td>
                  <td className="td py-2 font-semibold tabular-nums">{b.orNumbers.join(', ') || '—'}</td>
                  <td className="td whitespace-nowrap py-2">
                    {b.datePaid ? formatDate(b.datePaid) : <span className="text-slate-500">Due {formatDate(b.dueDate)}</span>}
                  </td>
                  <td className="td py-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {b.status !== 'PAID' && Number(b.paid) > 0 && (
                      <span className="block text-sm text-slate-600">{peso(b.balance)} left</span>
                    )}
                    <Link to={`/water/bills/${b.id}`} className="no-print block text-sm font-semibold text-brand-700 hover:underline">
                      Open bill
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {yearBills.length > 0 && (
            <tfoot className="border-t-2 border-slate-300 bg-slate-50">
              <tr>
                <td className="td font-bold" colSpan={3}>
                  Total for {year}
                </td>
                <td className="td text-right font-bold tabular-nums">{sum((b) => b.cubicMeters)}</td>
                <td className="td text-right font-bold tabular-nums">{peso(sum((b) => Number(b.amount) + Number(b.penalty)))}</td>
                <td className="td" colSpan={3}>
                  {sum((b) => Number(b.balance)) > 0 && (
                    <span className="font-bold text-red-700">Unpaid: {peso(sum((b) => Number(b.balance)))}</span>
                  )}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {connection.status !== 'PENDING_INSTALLATION' && (
        <p className="border-t border-slate-200 px-5 py-2 text-sm text-slate-500">
          Reading when installed: <span className="tabular-nums">{connection.initialReading}</span>
        </p>
      )}
    </Card>
  );
}
