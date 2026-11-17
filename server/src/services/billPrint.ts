import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { fromDbDate, todayManila } from '../lib/dates';
import { addDays, periodLabel } from '../lib/periods';
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

/** One unpaid month on the 2-month notice. Amount and penalty are what is still owed. */
export interface NoticeRow {
  month: string;
  cubicMeters: number;
  amount: string;
  penalty: string;
  total: string;
}

export interface PrintBill {
  /** BILL = the monthly bill; NOTICE = the 2-month unpaid notice (shown instead of the bill). */
  form: 'BILL' | 'NOTICE';
  /** Months with money still owed, counting this month. */
  unpaidMonths: number;
  notice: {
    rows: NoticeRow[];
    totals: { amount: string; penalty: string; total: string };
    dueDate: string;
    disconnectionDate: string;
  } | null;
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

export interface NoticeHeader {
  coopName: string;
  coopAddress: string;
  cdaNo: string;
  phoneLine: string;
  penaltyLabel: string;
  reconnectionFee: string;
  thresholdMonths: number;
  perPage: 1 | 2;
  paper: 'LETTER' | 'LONG';
  signatories: { name: string; title: string; label: string }[];
}

export interface PrintOptions {
  period: string;
  areaIds: number[];
  unpaidOnly: boolean;
  sort: 'AREA' | 'METER';
  /** Which form to return: 'BILL', 'NOTICE', or both ('ALL'). */
  form?: 'BILL' | 'NOTICE' | 'ALL';
  /** A disconnection date for the whole batch, instead of the rule. */
  disconnectDate?: string | null;
}

/** "Jan-Mar 2026", or "Nov 2025-Mar 2026" across a new year (also used for combined rows). */
export function monthSpan(from: string, to: string): string {
  return monthRange(from, to);
}

export function noticeHeader(s: Settings): NoticeHeader {
  const percent = s.water_penalty_type !== 'FIXED';
  const value = Number(s.water_penalty_value);
  return {
    coopName: s.coop_name.toUpperCase(),
    coopAddress: s.coop_address,
    cdaNo: s.coop_cda_no,
    phoneLine: s.notice_phone_line,
    penaltyLabel: percent ? `PENALTY (${Number.isInteger(value) ? value : value.toFixed(2)}%)` : 'PENALTY',
    reconnectionFee: Number(s.reconnection_fee).toFixed(2),
    thresholdMonths: Math.max(2, parseInt(s.notice_threshold_months, 10) || 2),
    perPage: s.notice_per_page === '2' ? 2 : 1,
    paper: s.bill_paper === 'LONG' ? 'LONG' : 'LETTER',
    signatories: [
      { label: 'Prepared by:', name: s.notice_preparer_name, title: s.notice_preparer_title },
      { label: '', name: s.notice_cashier_name, title: s.notice_cashier_title },
      { label: '', name: s.notice_manager_name, title: s.notice_manager_title },
    ],
  };
}

const zero = () => new Prisma.Decimal(0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (period: string) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
/** "Jan-Mar 2026", or "Nov 2025-Mar 2026" across a new year. */
const monthRange = (from: string, to: string) =>
  from.slice(0, 4) === to.slice(0, 4)
    ? `${MONTHS[Number(from.slice(5)) - 1]}-${MONTHS[Number(to.slice(5)) - 1]} ${to.slice(0, 4)}`
    : `${shortMonth(from)}-${shortMonth(to)}`;

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
export async function buildPrintBills(opts: PrintOptions | { billIds: number[]; disconnectDate?: string | null }): Promise<PrintBill[]> {
  const today = todayManila();
  const settings = await getSettings(prisma);
  const threshold = Math.max(2, parseInt(settings.notice_threshold_months, 10) || 2);
  const disconnectDays = Math.max(0, parseInt(settings.disconnect_days_after_due, 10) || 0);
  // A landscape notice holds 12 month rows; half a page holds 6. Older months are combined.
  const noticeMaxRows = settings.notice_per_page === '2' ? 6 : 12;
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
        month: monthRange(combine[0].bill.period, combine[combine.length - 1].bill.period),
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

    // The 2-month notice: every month still owed, with what is left of its amount and its penalty.
    // A payment counts against the amount first, then the penalty.
    const unpaid = [...owedBefore, ...(state.balance.gt(0) ? [{ bill, state }] : [])];
    const isNotice = unpaid.length >= threshold;
    const split = (e: (typeof unpaid)[number]) => {
      const paidToAmount = Prisma.Decimal.min(e.state.paid, e.bill.amount);
      const amount = e.bill.amount.minus(paidToAmount);
      const penalty = Prisma.Decimal.max(zero(), e.state.penalty.minus(e.state.paid.minus(paidToAmount)));
      return { amount, penalty };
    };
    let notice: PrintBill['notice'] = null;
    if (isNotice) {
      const parts = unpaid.map((e) => ({ e, ...split(e) }));
      const extra = parts.length > noticeMaxRows ? parts.slice(0, parts.length - noticeMaxRows + 1) : [];
      const noticeRows: NoticeRow[] = [];
      if (extra.length) {
        const amount = extra.reduce((sum, p) => sum.plus(p.amount), zero());
        const penalty = extra.reduce((sum, p) => sum.plus(p.penalty), zero());
        noticeRows.push({
          month: monthRange(extra[0].e.bill.period, extra[extra.length - 1].e.bill.period),
          cubicMeters: extra.reduce((n, p) => n + p.e.bill.cubicMeters, 0),
          amount: amount.toFixed(2),
          penalty: penalty.toFixed(2),
          total: amount.plus(penalty).toFixed(2),
        });
      }
      for (const p of parts.slice(extra.length)) {
        noticeRows.push({
          month: shortMonth(p.e.bill.period),
          cubicMeters: p.e.bill.cubicMeters,
          amount: p.amount.toFixed(2),
          penalty: p.penalty.toFixed(2),
          total: p.amount.plus(p.penalty).toFixed(2),
        });
      }
      const sumOf = (pick: (p: (typeof parts)[number]) => Prisma.Decimal) => parts.reduce((sum, p) => sum.plus(pick(p)), zero());
      const due = fromDbDate(bill.dueDate)!;
      notice = {
        rows: noticeRows,
        totals: { amount: sumOf((p) => p.amount).toFixed(2), penalty: sumOf((p) => p.penalty).toFixed(2), total: totalDue.toFixed(2) },
        dueDate: due,
        disconnectionDate: opts.disconnectDate || addDays(due, disconnectDays),
      };
    }

    const c = bill.connection;
    const a = c.account;
    return {
      form: (isNotice ? 'NOTICE' : 'BILL') as PrintBill['form'],
      unpaidMonths: unpaid.length,
      notice,
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

  const wanted = 'billIds' in opts || !opts.form || opts.form === 'ALL' ? null : opts.form;
  const filtered = result.filter(
    (b) => ('billIds' in opts || !opts.unpaidOnly || Number(b.totalDue) > 0) && (!wanted || b.form === wanted),
  );
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

export async function noticeSettings() {
  return noticeHeader(await getSettings(prisma));
}

export { periodLabel };
