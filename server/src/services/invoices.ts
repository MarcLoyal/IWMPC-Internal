import { Prisma, type PaymentType } from '@prisma/client';
import { LONG_TX, prisma, type Db } from '../lib/prisma';
import { AppError, notFound } from '../lib/errors';
import { formatDate, fromDbDate, todayManila } from '../lib/dates';
import { normalizeOr } from '../lib/orNumbers';
import { audit } from './audit';
import { getSettings } from './settings';
import { addPayment, type NewPayment } from './payments';
import { WALK_IN, addSale, itemsSummary, priceItems, type SaleItemInput } from './sales';
import { addLoanLines, loanStateInclude, splitFor } from './loans';
import type { PayoffRule, Split } from './loanMath';

/*
 * BIR Service Invoices. IWMPC writes invoices by hand from a bound booklet; the system never prints
 * them. With each visit the cashier types the invoice number, and the system saves the payments
 * under it and shows a guide of what to write on the paper invoice.
 */

export type InvoiceItem =
  | { type: 'WATER_BILL'; waterBillId: number | null; amount: Prisma.Decimal }
  | { type: 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'SHARE_CAPITAL'; amount: Prisma.Decimal }
  | { type: 'OTHER'; amount: Prisma.Decimal; description: string }
  /** A payment toward an earlier Rice & LPG credit sale. */
  | { type: 'RICE_LPG'; saleId: number; amount: Prisma.Decimal }
  /** A new Rice & LPG sale. */
  | { type: 'SALE'; items: SaleItemInput[] }
  /** A loan payment: any amount, or the whole payoff. Split penalty → interest → principal. */
  | { type: 'LOAN'; loanId: number; amount: Prisma.Decimal; payoff: boolean };

export interface NewInvoice {
  /** Empty for a walk-in customer (Rice & LPG only). */
  accountId: number | null;
  walkInName: string;
  number: string;
  items: InvoiceItem[];
  /** A Rice & LPG sale on credit: a CHARGE invoice with no payment yet. */
  credit?: boolean;
}

const zero = () => new Prisma.Decimal(0);

// ---- Invoice numbers -----------------------------------------------------------------------------

/** "Invoice No. 28101 was already used for Juan Dela Cruz on Nov 5, 2026." */
export async function numberUsedError(db: Db, number: string): Promise<AppError | null> {
  const invoice = await db.invoice.findUnique({ where: { number }, include: { account: { select: { fullName: true } } } });
  if (invoice) {
    const who = invoice.account?.fullName ?? (invoice.walkInName || WALK_IN);
    const cancelled = invoice.status === 'VOID' ? ' (that invoice was cancelled)' : '';
    return new AppError(409, `Invoice No. ${number} was already used for ${who} on ${formatDate(fromDbDate(invoice.invoiceDate)!)}${cancelled}. Please check the invoice booklet.`);
  }
  // Numbers recorded before invoices were kept (and the first payment of each invoice).
  const payment = await db.payment.findUnique({
    where: { orNumber: number },
    include: { account: { select: { fullName: true } }, sale: { select: { walkInName: true } } },
  });
  if (payment) {
    const who = payment.account?.fullName ?? (payment.sale?.walkInName || WALK_IN);
    const voided = payment.status === 'VOID' ? ' (that payment was voided)' : '';
    return new AppError(409, `Invoice No. ${number} was already used for ${who} on ${formatDate(fromDbDate(payment.paymentDate)!)}${voided}. Please check the invoice booklet.`);
  }
  return null;
}

export interface Series {
  from: number;
  to: number;
  atpNo: string;
  atpDate: string;
  /** The highest number used within the series, or null. */
  highest: number | null;
  /** Numbers left in the booklet series. */
  remaining: number;
}

export async function invoiceSeries(db: Db = prisma): Promise<Series> {
  const s = await getSettings(db);
  const from = parseInt(s.invoice_series_from, 10) || 0;
  const to = parseInt(s.invoice_series_to, 10) || 0;
  const rows = await db.$queryRaw<{ highest: number | null }[]>`
    SELECT MAX(n) AS highest FROM (
      SELECT CAST(number AS BIGINT) AS n FROM invoices WHERE number ~ '^[0-9]{1,15}$'
      UNION ALL
      SELECT CAST(or_number AS BIGINT) AS n FROM payments WHERE or_number ~ '^[0-9]{1,15}$'
    ) used WHERE n BETWEEN ${from} AND ${to}`;
  const highest = rows[0]?.highest === null || rows[0]?.highest === undefined ? null : Number(rows[0].highest);
  return { from, to, atpNo: s.invoice_atp_no, atpDate: s.invoice_atp_date, highest, remaining: Math.max(0, to - (highest ?? from - 1)) };
}

/** Checks a typed invoice number: already used (blocked), or outside the approved series (a warning). */
export async function checkNumber(raw: string) {
  const number = normalizeOr(raw);
  const series = await invoiceSeries();
  const numeric = /^\d+$/.test(number);
  const n = numeric ? Number(number) : NaN;
  const used = number ? await numberUsedError(prisma, number) : null;
  let warning: string | null = null;
  if (number && !numeric) warning = `Invoice No. ${number} is not a plain number. Please check the booklet.`;
  else if (number && series.to > 0 && (n < series.from || n > series.to)) {
    warning = `Invoice No. ${number} is outside the approved series (${series.from.toLocaleString('en-US')} to ${series.to.toLocaleString('en-US')}). Please check the booklet.`;
  }
  return { number, used: used?.message ?? null, warning, series };
}

/** The next number for this cashier: their last invoice + 1 (always editable on screen). */
export async function suggestNumber(userId: number): Promise<string> {
  const last = await prisma.invoice.findFirst({ where: { createdById: userId }, orderBy: { id: 'desc' } });
  if (!last || !/^\d+$/.test(last.number)) return '';
  const next = String(Number(last.number) + 1).padStart(last.number.length, '0');
  return (await numberUsedError(prisma, next)) ? '' : next;
}

// ---- Saving an invoice ---------------------------------------------------------------------------

function check(input: NewInvoice) {
  if (!input.items.length) throw new AppError(400, 'Please add at least one item to the invoice.');
  if (!input.accountId && input.items.some((i) => i.type !== 'SALE')) {
    throw new AppError(400, 'A walk-in customer can only buy Rice & LPG. Please pick an account for other payments.');
  }
  const bills = input.items.flatMap((i) => (i.type === 'WATER_BILL' && i.waterBillId ? [i.waterBillId] : []));
  if (new Set(bills).size !== bills.length) throw new AppError(400, 'The same water bill is on this invoice twice. Please remove one.');
  const loans = input.items.flatMap((i) => (i.type === 'LOAN' ? [i.loanId] : []));
  if (new Set(loans).size !== loans.length) throw new AppError(400, 'The same loan is on this invoice twice. Please put it on once.');
  if (input.credit && (input.items.length !== 1 || input.items[0].type !== 'SALE')) {
    throw new AppError(400, 'A credit sale must be on its own invoice.');
  }
}

/** Saves an invoice and all its payments in one step: all or nothing. */
export async function createInvoice(input: NewInvoice, userId: number) {
  const number = normalizeOr(input.number);
  check(input);
  if (input.credit) {
    const settings = await getSettings(prisma);
    if (settings.allow_credit !== 'true') throw new AppError(400, 'Credit sales are turned off. This sale must be paid in cash.');
    if (!input.accountId) throw new AppError(400, 'A walk-in customer cannot buy on credit. Please pick an account.');
  }
  if (!number) throw new AppError(400, 'Please enter the Invoice No. from the invoice booklet.');
  const date = todayManila();
  try {
    return await prisma.$transaction(async (tx) => {
      const used = await numberUsedError(tx, number);
      if (used) throw used;
      if (input.accountId && !(await tx.account.findUnique({ where: { id: input.accountId }, select: { id: true } }))) throw notFound('This account');

      const invoice = await tx.invoice.create({
        data: {
          number,
          accountId: input.accountId,
          walkInName: input.accountId ? '' : input.walkInName.trim(),
          invoiceDate: new Date(`${date}T00:00:00Z`),
          saleType: input.credit ? 'CHARGE' : 'CASH',
          createdById: userId,
        },
      });
      const payments = [];
      let saleId: number | null = null;
      let n = 0;
      for (const item of input.items) {
        n += 1;
        // The first payment keeps the invoice number itself; the others get number#2, number#3...
        const orKey = n === 1 ? number : `${number}#${n}`;
        if (item.type === 'LOAN') {
          payments.push(await addLoanPayment(tx, item, input.accountId!, userId, { orKey, invoiceId: invoice.id, paymentDate: date }));
          continue;
        }
        if (item.type === 'SALE') {
          const sale = await addSale(tx, { accountId: input.accountId, walkInName: input.walkInName, items: item.items, credit: !!input.credit, saleDate: date }, userId);
          saleId = sale.id;
          if (input.credit) continue;
          const payment = await tx.payment.create({
            data: {
              accountId: input.accountId,
              type: 'RICE_LPG',
              amount: sale.total,
              orNumber: orKey,
              invoiceId: invoice.id,
              paymentDate: new Date(`${date}T00:00:00Z`),
              saleId: sale.id,
              description: itemsSummary(sale.items),
              createdById: userId,
            },
          });
          await audit(tx, userId, 'payment.create', 'payment', payment.id, null, payment);
          payments.push(payment);
        } else {
          const p: Omit<NewPayment, 'orNumber'> = {
            accountId: input.accountId!,
            type: (item.type === 'RICE_LPG' ? 'RICE_LPG' : item.type) as PaymentType,
            amount: item.amount,
            description: item.type === 'OTHER' ? item.description : '',
            waterBillId: item.type === 'WATER_BILL' ? item.waterBillId : null,
            saleId: item.type === 'RICE_LPG' ? item.saleId : null,
          };
          payments.push(await addPayment(tx, p, userId, { orKey, invoiceId: invoice.id, paymentDate: date }));
        }
      }
      const saved = saleId && input.credit ? await tx.invoice.update({ where: { id: invoice.id }, data: { saleId } }) : invoice;
      await audit(tx, userId, 'invoice.create', 'invoice', invoice.id, null, { ...saved, payments: payments.map((p) => p.id) });
      return { invoice: saved, payments, saleId };
    }, LONG_TX);
  } catch (err) {
    // Two cashiers saving the same number at the same moment: the database's unique rule catches it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw (await numberUsedError(prisma, number)) ?? new AppError(409, `Invoice No. ${number} was already used.`);
    }
    throw err;
  }
}

/** One payment on its own invoice (the invoice number is the payment's number). */
export async function recordPayment(input: NewPayment, userId: number) {
  const { type, amount, description, waterBillId, saleId, accountId } = input;
  const item: InvoiceItem =
    type === 'WATER_BILL'
      ? { type, waterBillId: waterBillId ?? null, amount }
      : type === 'OTHER'
        ? { type, amount, description }
        : type === 'RICE_LPG'
          ? { type, saleId: saleId ?? 0, amount }
          : { type: type as 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'SHARE_CAPITAL', amount };
  if (type === 'RICE_LPG' && !saleId) {
    throw new AppError(400, 'To sell rice or LPG, pick "Rice & LPG" and add the items. To pay an earlier credit sale, click "Pay This" beside it.');
  }
  if (type === 'OTHER' && !description.trim()) throw new AppError(400, 'Please type a short description of what this payment is for.');
  if (amount.lte(0)) throw new AppError(400, 'Please enter an amount greater than zero.');
  const { payments } = await createInvoice({ accountId, walkInName: '', number: input.orNumber, items: [item] }, userId);
  return payments[0];
}

/** A Rice & LPG sale on its own invoice (cash), or a charge invoice (credit). */
export async function createSale(
  input: { accountId: number | null; walkInName: string; items: SaleItemInput[]; orNumber: string; credit: boolean },
  userId: number,
) {
  const { invoice, payments, saleId } = await createInvoice(
    { accountId: input.accountId, walkInName: input.walkInName, number: input.orNumber, items: [{ type: 'SALE', items: input.items }], credit: input.credit },
    userId,
  );
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId! }, include: { items: true } });
  return { sale, payment: payments[0] ?? null, invoice };
}

// ---- The guide: what to write on the paper invoice ------------------------------------------------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** 280.70 -> "Two Hundred Eighty Pesos and 70/100" */
export function amountInWords(value: Prisma.Decimal | string): string {
  const [wholeText, cents] = new Prisma.Decimal(value).toFixed(2).split('.');
  let whole = Number(wholeText);
  if (whole === 0) return `Zero Pesos and ${cents}/100`;
  const groups: string[] = [];
  for (const [size, name] of [
    [1_000_000_000, 'Billion'],
    [1_000_000, 'Million'],
    [1_000, 'Thousand'],
  ] as const) {
    if (whole >= size) {
      groups.push(`${under1000(Math.floor(whole / size))} ${name}`);
      whole %= size;
    }
  }
  if (whole > 0) groups.push(under1000(whole));
  const words = groups.join(' ');
  return `${words} ${words === 'One' ? 'Peso' : 'Pesos'} and ${cents}/100`;
}

interface WaterPart {
  bill: Prisma.WaterBillGetPayload<{ include: { reading: true; connection: true } }>;
  paidBefore: Prisma.Decimal;
  amount: Prisma.Decimal;
}

interface Parts {
  loan: { principal: Prisma.Decimal; interest: Prisma.Decimal; penalty: Prisma.Decimal };
  water: WaterPart[];
  installation: Prisma.Decimal;
  store: { amount: Prisma.Decimal; items: string[] };
  others: { label: string; amount: Prisma.Decimal }[];
}

const OTHER_LABEL: Partial<Record<PaymentType, string>> = { MEMBERSHIP_FEE: 'Membership Fee', SHARE_CAPITAL: 'Share Capital' };

function guideFrom(
  parts: Parts,
  head: { number: string; date: string; saleType: string; status: string; cancelReason: string | null },
  buyer: { name: string; tin: string; address: string; meterNo: string },
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  // A payment toward a water bill counts against the water amount first, then the penalty.
  let water = zero();
  let penalty = zero();
  for (const w of parts.water) {
    const left = Prisma.Decimal.max(zero(), w.bill.amount.minus(w.paidBefore));
    const toWater = Prisma.Decimal.min(w.amount, left);
    water = water.plus(toWater);
    penalty = penalty.plus(w.amount.minus(toWater));
  }
  const sorted = [...parts.water].sort((a, b) => a.bill.period.localeCompare(b.bill.period));
  const others = parts.others.reduce((sum, o) => sum.plus(o.amount), zero());
  const loanTotal = parts.loan.principal.plus(parts.loan.interest).plus(parts.loan.penalty);
  const total = water.plus(penalty).plus(parts.installation).plus(parts.store.amount).plus(loanTotal).plus(others);
  const money = (d: Prisma.Decimal) => (d.gt(0) ? d.toFixed(2) : null);
  const meters = [...new Set(sorted.map((w) => [w.bill.connection.meterName, w.bill.connection.meterSerial && `# ${w.bill.connection.meterSerial}`].filter(Boolean).join(' ')))].filter(Boolean);
  const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' }).replace(' ', " '");

  return {
    header: {
      coopName: settings.coop_name.toUpperCase(),
      coopAddress: settings.coop_address,
      tinLine: settings.invoice_tin_line,
      phoneLine: settings.invoice_phone_line,
      atpNo: settings.invoice_atp_no,
      atpDate: settings.invoice_atp_date,
      seriesFrom: settings.invoice_series_from,
      seriesTo: settings.invoice_series_to,
    },
    number: head.number,
    date: head.date,
    cashSales: head.saleType !== 'CHARGE',
    chargeSales: head.saleType === 'CHARGE',
    cancelled: head.status === 'VOID',
    cancelReason: head.cancelReason,
    registeredName: buyer.name,
    tin: buyer.tin,
    meterNo: meters.join(', ') || buyer.meterNo,
    businessAddress: buyer.address,
    // As IWMPC writes it: one month goes on "To" only; From is filled when several months are paid.
    periodFrom: sorted.length > 1 && sorted[0].bill.period !== sorted[sorted.length - 1].bill.period ? monthName(sorted[0].bill.period) : '',
    periodTo: sorted.length ? monthName(sorted[sorted.length - 1].bill.period) : '',
    water: sorted.length
      ? {
          present: sorted[sorted.length - 1].bill.reading.currentReading,
          previous: sorted[0].bill.reading.previousReading,
          cubicMeters: sorted.reduce((n, w) => n + w.bill.cubicMeters, 0),
          amount: money(water),
        }
      : null,
    assessment: null as string | null,
    penalty: money(penalty),
    connection: money(parts.installation),
    store: parts.store.amount.gt(0) ? { amount: parts.store.amount.toFixed(2), items: parts.store.items } : null,
    loans: money(parts.loan.principal),
    loanInterest: money(parts.loan.interest),
    loanPenalty: money(parts.loan.penalty),
    others: parts.others.map((o) => ({ label: o.label, amount: o.amount.toFixed(2) })),
    othersTotal: money(others),
    totalSales: total.toFixed(2),
    discount: null as string | null,
    withholdingTax: null as string | null,
    totalAmountDue: total.toFixed(2),
    amountInWords: amountInWords(total),
  };
}

export type Guide = ReturnType<typeof guideFrom>;

async function buyerOf(accountId: number | null, walkInName: string) {
  if (!accountId) return { name: walkInName || WALK_IN, tin: '', address: '', meterNo: '' };
  const a = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, include: { connections: { where: { status: 'ACTIVE' } } } });
  const c = a.connections[0];
  return { name: a.fullName, tin: a.tin, address: a.address, meterNo: c ? [c.meterName, c.meterSerial && `# ${c.meterSerial}`].filter(Boolean).join(' ') : '' };
}

/** The guide for a saved invoice, exactly as it was issued. */
export async function invoiceGuide(invoiceId: number): Promise<Guide> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: { orderBy: { id: 'asc' }, include: { waterBill: { include: { reading: true, connection: true, payments: true } }, sale: { include: { items: true } }, loanLines: true } },
      sale: { include: { items: true } },
    },
  });
  if (!invoice) throw notFound('This invoice');
  const parts: Parts = emptyParts();
  for (const p of invoice.payments) {
    if (p.type === 'LOAN') addSplits(parts, p.loanLines);
    else if (p.type === 'WATER_BILL' && p.waterBill) {
      // Paid on this bill before this invoice (not counting payments voided since).
      const paidBefore = p.waterBill.payments.filter((x) => x.id < p.id && x.status === 'ACTIVE').reduce((s, x) => s.plus(x.amount), zero());
      parts.water.push({ bill: p.waterBill, paidBefore, amount: p.amount });
    } else if (p.type === 'INSTALLATION_FEE') parts.installation = parts.installation.plus(p.amount);
    else if (p.type === 'RICE_LPG') {
      parts.store.amount = parts.store.amount.plus(p.amount);
      parts.store.items.push(p.sale && !p.sale.isCredit ? itemsSummary(p.sale.items) : `Payment for credit purchase${p.sale ? ` of ${formatDate(fromDbDate(p.sale.saleDate)!)}` : ''}`);
    } else parts.others.push({ label: OTHER_LABEL[p.type] ?? (p.description ? `Others: ${p.description}` : 'Others'), amount: p.amount });
  }
  // A charge invoice (credit sale): the goods, with no payment yet.
  if (invoice.saleType === 'CHARGE' && invoice.sale) {
    parts.store.amount = parts.store.amount.plus(invoice.sale.total);
    parts.store.items.push(itemsSummary(invoice.sale.items));
  }
  const settings = await getSettings(prisma);
  return guideFrom(
    parts,
    { number: invoice.number, date: fromDbDate(invoice.invoiceDate)!, saleType: invoice.saleType, status: invoice.status, cancelReason: invoice.cancelReason },
    await buyerOf(invoice.accountId, invoice.walkInName),
    settings,
  );
}

/** The guide for an invoice that is not saved yet (the cashier's "Review Payment"). */
export async function previewGuide(input: NewInvoice): Promise<Guide> {
  check(input);
  const account = input.accountId ? await prisma.account.findUnique({ where: { id: input.accountId } }) : null;
  if (input.accountId && !account) throw notFound('This account');
  const parts: Parts = emptyParts();
  const rule = (await getSettings(prisma)).loan_payoff_rule as PayoffRule;
  for (const item of input.items) {
    if (item.type === 'LOAN') {
      const loan = await prisma.loan.findUnique({ where: { id: item.loanId }, include: loanStateInclude });
      if (!loan || loan.accountId !== input.accountId) throw new AppError(400, 'This loan was not found on this account.');
      addSplits(parts, splitFor(loan, item.amount, item.payoff, rule));
    } else if (item.type === 'WATER_BILL') {
      const bill = item.waterBillId
        ? await prisma.waterBill.findUnique({ where: { id: item.waterBillId }, include: { reading: true, connection: true, payments: true } })
        : null;
      if (!bill || bill.connection.accountId !== input.accountId) throw new AppError(400, 'This water bill was not found on this account.');
      const paidBefore = bill.payments.filter((x) => x.status === 'ACTIVE').reduce((s, x) => s.plus(x.amount), zero());
      parts.water.push({ bill, paidBefore, amount: item.amount });
    } else if (item.type === 'INSTALLATION_FEE') parts.installation = parts.installation.plus(item.amount);
    else if (item.type === 'SALE') {
      const { lines, total } = await priceItems(prisma, item.items, account?.isMember ?? false);
      parts.store.amount = parts.store.amount.plus(total);
      parts.store.items.push(itemsSummary(lines));
    } else if (item.type === 'RICE_LPG') {
      parts.store.amount = parts.store.amount.plus(item.amount);
      parts.store.items.push('Payment for credit purchase');
    } else {
      parts.others.push({ label: OTHER_LABEL[item.type] ?? (item.type === 'OTHER' && item.description ? `Others: ${item.description}` : 'Others'), amount: item.amount });
    }
  }
  return guideFrom(
    parts,
    { number: normalizeOr(input.number), date: todayManila(), saleType: input.credit ? 'CHARGE' : 'CASH', status: 'ACTIVE', cancelReason: null },
    await buyerOf(input.accountId, input.walkInName),
    await getSettings(prisma),
  );
}

// ---- Loans on an invoice ------------------------------------------------------------------------

function emptyParts(): Parts {
  return { loan: { principal: zero(), interest: zero(), penalty: zero() }, water: [], installation: zero(), store: { amount: zero(), items: [] }, others: [] };
}

/** C. Loans Receivable (principal), C1. Interest, C2. Penalty/Surcharge. */
function addSplits(parts: Parts, splits: Pick<Split, 'principal' | 'interest' | 'penalty'>[]) {
  for (const s of splits) {
    parts.loan.principal = parts.loan.principal.plus(s.principal);
    parts.loan.interest = parts.loan.interest.plus(s.interest);
    parts.loan.penalty = parts.loan.penalty.plus(s.penalty);
  }
}

/** One loan payment inside the invoice's transaction: the payment, then how it was split. */
async function addLoanPayment(
  tx: Prisma.TransactionClient,
  item: { loanId: number; amount: Prisma.Decimal; payoff: boolean },
  accountId: number,
  userId: number,
  opts: { orKey: string; invoiceId: number; paymentDate: string },
) {
  // Lock the loan so two cashiers cannot split the same installment at the same moment.
  await tx.$queryRaw`SELECT id FROM loans WHERE id = ${item.loanId} FOR UPDATE`;
  const loan = await tx.loan.findUnique({ where: { id: item.loanId }, include: loanStateInclude });
  if (!loan || loan.accountId !== accountId) throw new AppError(400, 'This loan was not found on this account.');
  const rule = (await getSettings(tx)).loan_payoff_rule as PayoffRule;
  const splits = splitFor(loan, item.amount, item.payoff, rule, opts.paymentDate);
  const amount = splits.reduce((s, x) => s.plus(x.penalty).plus(x.interest).plus(x.principal), zero());
  const payment = await tx.payment.create({
    data: {
      accountId,
      type: 'LOAN',
      amount,
      orNumber: opts.orKey,
      invoiceId: opts.invoiceId,
      paymentDate: new Date(`${opts.paymentDate}T00:00:00Z`),
      loanId: loan.id,
      description: `Loan ${loan.number}${item.payoff ? ', paid off' : ''}`,
      createdById: userId,
    },
  });
  await audit(tx, userId, 'payment.create', 'payment', payment.id, null, {
    ...payment,
    split: {
      penalty: splits.reduce((s, x) => s.plus(x.penalty), zero()),
      interest: splits.reduce((s, x) => s.plus(x.interest), zero()),
      principal: splits.reduce((s, x) => s.plus(x.principal), zero()),
    },
  });
  await addLoanLines(tx, payment.id, loan.id, splits, opts.paymentDate);
  return payment;
}
