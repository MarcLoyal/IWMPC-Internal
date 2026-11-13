import { formatDate, peso } from '../lib/format';
import type { RateClass, WaterBill } from '../lib/types';
import { BILL_STATUS, RATE_CLASS, periodLabel } from '../lib/water';
import { Badge } from './ui';

export interface BillView {
  bill: WaterBill;
  account: { id: number; name: string; accountNumber: string; address: string; area: string };
  meter: string;
  rateClass: RateClass;
  penaltyIfLate: string;
  previousBalance: string;
  previousMonths: string[];
  totalDue: string;
  coop: { name: string; address: string; cdaNo: string };
}

function Line({ label, children, strong = false }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'text-xl font-bold' : ''}`}>
      <span className={strong ? '' : 'text-slate-600'}>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

/** The body of a water bill / notice. Used in the pop-up and on the bill's own page. */
export function BillContent({ data }: { data: BillView }) {
  const { bill, account } = data;
  const status = BILL_STATUS[bill.status];
  return (
    <>
        <div className="border-b border-slate-300 pb-4 text-center">
          <img src="/logo.png" alt="" className="mx-auto mb-1 h-16 w-16" />
          <div className="text-lg font-bold">{data.coop.name}</div>
          {data.coop.address && <div className="text-sm">{data.coop.address}</div>}
          {data.coop.cdaNo && <div className="text-sm">CDA Reg. No. {data.coop.cdaNo}</div>}
          <div className="mt-2 text-base font-bold uppercase tracking-wide">Water Bill · {periodLabel(bill.period)}</div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 py-4">
          <div>
            <div className="text-xl font-bold">{account.name}</div>
            <div className="text-slate-600">{account.address || account.area}</div>
            <div className="text-slate-600">
              Account No. <span className="tabular-nums">{account.accountNumber}</span>
              {data.meter && (
                <>
                  {' '}
                  · Meter No. <span className="tabular-nums">{data.meter}</span>
                </>
              )}
            </div>
            <div className="text-slate-600">{RATE_CLASS[data.rateClass] ?? data.rateClass}</div>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <div className="divide-y divide-slate-200 border-y border-slate-300">
          <Line label={`Present reading (${formatDate(bill.readDate)})`}>{bill.currentReading}</Line>
          <Line label="Previous reading">{bill.previousReading}</Line>
          <Line label="Water used">{bill.cubicMeters} cu.m</Line>
          <Line label={`Amount for ${periodLabel(bill.period)}`}>{peso(bill.amount)}</Line>
          {Number(bill.penalty) > 0 && <Line label="Late penalty">{peso(bill.penalty)}</Line>}
          {Number(bill.paid) > 0 && <Line label={`Paid${bill.orNumbers.length ? ` (OR ${bill.orNumbers.join(', ')})` : ''}`}>− {peso(bill.paid)}</Line>}
          {Number(data.previousBalance) > 0 && (
            <Line label={`Previous Balance (${data.previousMonths.join(', ')})`}>{peso(data.previousBalance)}</Line>
          )}
          <Line label="Total Due" strong>
            {peso(data.totalDue)}
          </Line>
        </div>

        <div className="pt-4 text-slate-700">
          {bill.status === 'PAID' ? (
            <p>
              Paid on <strong>{formatDate(bill.datePaid)}</strong>. Thank you.
            </p>
          ) : (
            <>
              <p>
                Please pay on or before <strong>{formatDate(bill.dueDate)}</strong>.
              </p>
              {Number(bill.penalty) === 0 && Number(data.penaltyIfLate) > 0 && (
                <p>A late penalty of {peso(data.penaltyIfLate)} is added after the due date.</p>
              )}
            </>
          )}
          <p className="mt-3 text-sm text-slate-500">This is not an Official Receipt. Please ask for your Official Receipt when you pay.</p>
        </div>
    </>
  );
}
