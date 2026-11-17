import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { fromDbDate, todayManila } from '../lib/dates';
import { periodLabel } from '../lib/periods';
import { getSettings, type Settings } from './settings';
import { billState, type BillStatus } from './water';

/*
 * The figures for printed water bills ("WATER SERVICE BILLING", 4 to a page). The server works out
 * every amount; the browser only draws them, so a printed bill always matches the account.
 */

/** Earlier unpaid months listed one by one; anything older is combined into one row. */
export const MAX_EARLIER_ROWS = 5;
export const BILLS_PER_PAGE = 4;

export interface BillRow {
  kind: 'EARLIER' | 'CURRENT' | 'PAYMENT' | 'COMBINED';
  month: string;
  cubicMeters: number | null;
  amount: string;
  withPenalty: boolean;
}

export interface PrintBill {
  billId: number;
  accountId: number;
  areaId: number;
  area: string;
  accountName: string;
  address: string;
  meterNo: string;
  period: string;
  dueDate: string;
  status: BillStatus;
  rows: BillRow[];
  totalDue: string;
}

export interface PrintHeader {
  coopName: string;
  coopAddress: string;
  cdaNo: string;
  phone: string;
  mobile: string;
  /** The first note line, e.g. "Due Date until 15th of the Month." */
  dueNote: string;
  paper: 'LETTER' | 'LONG';
  signatories: { name: string; title: string; label: string }[];
}

export interface PrintOptions {
  period: string;
  areaIds: number[];
  unpaidOnly: boolean;
  sort: 'AREA' | 'METER';
}

const zero = () => new Prisma.Decimal(0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (period: string) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export function printHeader(s: Settings): PrintHeader {
  return {
    coopName: s.coop_name.toUpperCase(),
    coopAddress: s.coop_address,
    cdaNo: s.coop_cda_no,
    phone: s.coop_phone,
    mobile: s.coop_mobile,
    dueNote:
      s.water_due_rule === 'DAYS_AFTER_READING'
        ? 'Please pay on or before the due date shown above.'
        : `Due Date until ${ordinal(parseInt(s.water_due_day, 10) || 15)} of the Month.`,
    paper: s.bill_paper === 'LONG' ? 'LONG' : 'LETTER',
    signatories: [
      { label: 'Prepared by:', name: s.bill_preparer_name, title: s.bill_preparer_title },
      { label: '', name: s.bill_cashier_name, title: s.bill_cashier_title },
      { label: '', name: s.bill_manager_name, title: s.bill_manager_title },
    ],
  };
}

const include = {
  payments: true,
  connection: { include: { account: { include: { area: true } } } },
} as const;

type FullBill = Prisma.WaterBillGetPayload<{ include: typeof include }>;

/** Builds the bills for one month (or the given bill ids), applying the filters and the sort. */
export async function buildPrintBills(opts: PrintOptions | { billIds: number[] }): Promise<PrintBill[]> {
  const today = todayManila();
  const bills: FullBill[] = await prisma.waterBill.findMany({
    where:
      'billIds' in opts
        ? { id: { in: opts.billIds } }
        : { period: opts.period, connection: opts.areaIds.length ? { account: { areaId: { in: opts.areaIds } } } : undefined },
    include,
  });
  if (!bills.length) return [];

  // Earlier months still owed, for every connection, in one query.
  const earlier = await prisma.waterBill.findMany({
    where: { connectionId: { in: [...new Set(bills.map((b) => b.connectionId))] }, settledOn: null },
    include: { payments: true },
    orderBy: [{ period: 'asc' }, { id: 'asc' }],
  });

  const result = bills.map((bill) => {
    const state = billState(bill, bill.payments, today);
    const owedBefore = earlier
      .filter((e) => e.connectionId === bill.connectionId && e.period < bill.period)
      .map((e) => ({ bill: e, state: billState(e, e.payments, today) }))
      .filter((e) => e.state.balance.gt(0));

    const rows: BillRow[] = [];
    // Older than the last few months: one combined row, so the bill always fits.
    const combine = owedBefore.length > MAX_EARLIER_ROWS ? owedBefore.slice(0, owedBefore.length - MAX_EARLIER_ROWS) : [];
    if (combine.length) {
      rows.push({
        kind: 'COMBINED',
        month: `Earlier months (${shortMonth(combine[0].bill.period)} - ${shortMonth(combine[combine.length - 1].bill.period)})`,
        cubicMeters: combine.reduce((n, e) => n + e.bill.cubicMeters, 0),
        amount: combine.reduce((sum, e) => sum.plus(e.state.balance), zero()).toFixed(2),
        withPenalty: combine.some((e) => e.state.penalty.gt(0)),
      });
    }
    for (const e of owedBefore.slice(combine.length)) {
      rows.push({
        kind: 'EARLIER',
        month: shortMonth(e.bill.period),
        cubicMeters: e.bill.cubicMeters,
        // What is still owed for that month, penalty included.
        amount: e.state.balance.toFixed(2),
        withPenalty: e.state.penalty.gt(0),
      });
    }
    rows.push({
      kind: 'CURRENT',
      month: shortMonth(bill.period),
      cubicMeters: bill.cubicMeters,
      amount: bill.amount.plus(state.penalty).toFixed(2),
      withPenalty: state.penalty.gt(0),
    });
    if (state.paid.gt(0)) {
      rows.push({ kind: 'PAYMENT', month: 'Less: payment received', cubicMeters: null, amount: state.paid.negated().toFixed(2), withPenalty: false });
    }
    const totalDue = owedBefore.reduce((sum, e) => sum.plus(e.state.balance), zero()).plus(state.balance);

    const c = bill.connection;
    const a = c.account;
    return {
      billId: bill.id,
      accountId: a.id,
      areaId: a.areaId,
      area: a.area.name,
      accountName: a.fullName,
      address: a.purok ? `${a.area.name.toUpperCase()}/${a.purok.toUpperCase()}` : a.area.name.toUpperCase(),
      meterNo: [c.meterName, c.meterSerial && `# ${c.meterSerial}`].filter(Boolean).join(' '),
      serial: c.meterSerial,
      period: bill.period,
      dueDate: fromDbDate(bill.dueDate)!,
      status: state.status,
      rows,
      totalDue: totalDue.toFixed(2),
    };
  });

  const filtered = 'billIds' in opts ? result : opts.unpaidOnly ? result.filter((b) => Number(b.totalDue) > 0) : result;
  const sort = 'billIds' in opts ? 'AREA' : opts.sort;
  filtered.sort((x, y) =>
    sort === 'METER'
      ? (x.serial || '￿').localeCompare(y.serial || '￿', 'en', { numeric: true }) || x.accountName.localeCompare(y.accountName)
      : x.areaId - y.areaId || x.accountName.localeCompare(y.accountName) || x.billId - y.billId,
  );
  return filtered.map(({ serial: _serial, ...rest }) => rest);
}

/** Active connections with no reading for the month: their bills cannot be printed yet. */
export async function missingReadings(period: string, areaIds: number[]) {
  const connections = await prisma.waterConnection.findMany({
    where: {
      status: 'ACTIVE',
      readings: { none: { period } },
      account: areaIds.length ? { areaId: { in: areaIds } } : undefined,
    },
    include: { account: { include: { area: true } } },
  });
  return connections
    .map((c) => ({
      accountId: c.accountId,
      name: c.account.fullName,
      area: c.account.area.name,
      areaId: c.account.areaId,
      meterNo: [c.meterName, c.meterSerial && `# ${c.meterSerial}`].filter(Boolean).join(' '),
    }))
    .sort((x, y) => x.areaId - y.areaId || x.name.localeCompare(y.name));
}

export async function printSettings() {
  return printHeader(await getSettings(prisma));
}

export { periodLabel };
