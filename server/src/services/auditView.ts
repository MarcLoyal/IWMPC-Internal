import type { AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { PAYMENT_TYPE_LABEL } from '../lib/labels';
import { formatPeso } from '../lib/money';
import { periodLabel } from '../lib/periods';

/** The groups an Admin can filter the Audit Log by. Each action belongs to exactly one. */
export const AUDIT_CATEGORIES = {
  money: { label: 'Payments, invoices and sales', prefixes: ['payment.', 'invoice.', 'sale.'] },
  readings: { label: 'Meter readings and bill printing', prefixes: ['reading.', 'bills.'] },
  accounts: { label: 'Accounts, connections and membership', prefixes: ['account.', 'connection.', 'membership.'] },
  users: { label: 'Users and passwords', prefixes: ['user.'] },
  access: { label: 'Logins and blocked attempts', prefixes: ['login', 'logout', 'access.', 'page.'] },
  settings: { label: 'Settings, rates, prices and signatures', prefixes: ['settings.', 'area.', 'rates.', 'product', 'price.', 'signature.', 'system.'] },
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

export function categoryOf(action: string): AuditCategory | 'other' {
  for (const [key, c] of Object.entries(AUDIT_CATEGORIES)) {
    if (c.prefixes.some((p) => action.startsWith(p))) return key as AuditCategory;
  }
  return 'other';
}

// ---- Field names and values in plain words ------------------------------------------------------

const FIELD_LABEL: Record<string, string> = {
  accountNumber: 'Account number',
  memberNumber: 'Member number',
  fullName: 'Full name',
  lastName: 'Last name',
  firstName: 'First name',
  middleName: 'Middle name',
  areaId: 'Area',
  orNumber: 'OR number',
  paymentDate: 'Payment date',
  type: 'Type',
  amount: 'Amount',
  total: 'Total',
  status: 'Status',
  voidReason: 'Reason for voiding',
  cancelReason: 'Reason for cancelling',
  voidedAt: 'Voided on',
  cancelledAt: 'Cancelled on',
  previousReading: 'Previous reading',
  currentReading: 'Current reading',
  readDate: 'Reading date',
  cubicMeters: 'Cubic meters used',
  penaltyAmount: 'Penalty if late',
  billDate: 'Bill date',
  dueDate: 'Due date',
  period: 'Billing month',
  isMember: 'Member',
  membershipStatus: 'Membership status',
  memberSince: 'Member since',
  name: 'Name',
  email: 'Email',
  role: 'Role',
  price: 'Price',
  memberPrice: 'Member price',
  label: 'Unit',
  active: 'In use',
  reason: 'Reason',
  isCredit: 'On credit',
  walkInName: 'Walk-in name',
  invoiceDate: 'Invoice date',
  number: 'Invoice number',
  saleType: 'Sale type',
  connectionNumber: 'Connection number',
  meterSerial: 'Meter serial',
  meterName: 'Meter brand',
  rateClass: 'Rate class',
  initialReading: 'Initial reading',
  installationDate: 'Installation date',
  effectiveFrom: 'Effective from',
  minimumCharge: 'Minimum charge',
  minimumCoversM3: 'Minimum covers (cu.m)',
  tiers: 'Rate blocks',
  method: 'Rate method',
  count: 'Number of bills',
  path: 'Page or action',
  removed: 'Removed',
  removedLogins: 'Removed logins',
  keptLogins: 'Kept logins',
  alsoRemovedOthers: 'Also removed records from other logins',
  workLabel: 'Work',
  requestedBy: 'Requested by',
  endsOn: 'Ends on',
  removeReason: 'Reason for removing',
};

// Never shown: internal ids, timestamps the entry already has, and anything secret.
const HIDDEN = new Set(['work', 'id', 'createdAt', 'createdById', 'passwordHash', 'voidedById', 'cancelledById', 'enteredById', 'rateScheduleId', 'readingId', 'billIds', 'payments', 'storageKey', 'data']);
const MONEY = new Set(['amount', 'total', 'price', 'memberPrice', 'penaltyAmount', 'minimumCharge', 'sharesAmount', 'oldPrice', 'newPrice', 'oldMemberPrice', 'newMemberPrice']);

const WORDS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Deactivated',
  VOID: 'Voided',
  PENDING_INSTALLATION: 'Waiting for installation',
  DISCONNECTED: 'Disconnected',
  ADMIN: 'Admin',
  CASHIER: 'Cashier',
  STAFF: 'Staff / Encoder',
  BOARD: 'Board (view only)',
  ...PAYMENT_TYPE_LABEL,
};

function labelFor(field: string): string {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field];
  const words = field.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const manila = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

export function showValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (MONEY.has(field) && (typeof value === 'string' || typeof value === 'number') && value !== '' && Number.isFinite(Number(value))) {
    return formatPeso(value);
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(value)) return day.format(new Date(value));
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return manila.format(new Date(value));
    if (field === 'period' && /^\d{4}-\d{2}$/.test(value)) return periodLabel(value);
    return WORDS[value] ?? value;
  }
  if (typeof value === 'number') return value.toLocaleString('en-US');
  // Simple lists and name/number pairs read as plain text: "a, b" and "Accounts: 16, Payments: 40".
  const plain = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  if (Array.isArray(value) && value.every(plain)) return value.length ? value.map((v) => showValue('', v)).join(', ') : '—';
  if (isObject(value) && Object.values(value).every(plain)) {
    return Object.entries(value).map(([k, v]) => `${k}: ${showValue(k, v)}`).join(', ') || '—';
  }
  const text = JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

export interface Change {
  field: string;
  label: string;
  before: string;
  after: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What changed. For something new, every filled-in detail; for an edit, only the fields that differ. */
export function changesOf(before: unknown, after: unknown): Change[] {
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !HIDDEN.has(k));
  const out: Change[] = [];
  for (const key of keys) {
    const was = showValue(key, b[key]);
    const now = showValue(key, a[key]);
    if (was === now) continue;
    out.push({ field: key, label: labelFor(key), before: isObject(before) ? was : '', after: isObject(after) ? now : '' });
  }
  return out;
}

// ---- One-line summaries ------------------------------------------------------------------------

type Json = Record<string, unknown>;
interface Names {
  accountOf: (entry: AuditLog) => { id: number; name: string } | null;
  userName: (id: number) => string | null;
}

const peso = (v: unknown) => (v === undefined || v === null || v === '' ? '' : formatPeso(String(v)));
const txt = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function summarize(entry: AuditLog, names: Names): string {
  const a = (isObject(entry.after) ? entry.after : {}) as Json;
  const b = (isObject(entry.before) ? entry.before : {}) as Json;
  const acct = names.accountOf(entry);
  const who = acct ? acct.name : a.walkInName || b.walkInName ? `Walk-in: ${txt(a.walkInName || b.walkInName)}` : '';
  const forWho = who ? ` · ${who}` : '';
  const reading = (x: Json) => `${txt(x.previousReading)} → ${txt(x.currentReading)} (${txt(x.cubicMeters)} cu.m, ${peso(x.amount)})`;

  switch (entry.action) {
    case 'payment.create':
      return `Received ${peso(a.amount)} for ${a.type === 'OTHER' ? txt(a.description) || 'Other' : (WORDS[txt(a.type)] ?? txt(a.type))} · OR ${txt(a.orNumber)}${forWho}`;
    case 'payment.void':
      return `Voided payment OR ${txt(b.orNumber || a.orNumber)} (${peso(b.amount || a.amount)})${forWho}`;
    case 'invoice.create':
      return `Saved service invoice ${txt(a.number)}${forWho}`;
    case 'invoice.cancel':
      return `Cancelled service invoice ${txt(b.number || a.number)}${forWho}`;
    case 'sale.create':
      return `Rice & LPG sale of ${peso(a.total)}${a.isCredit ? ' on credit' : ''}${forWho}`;
    case 'sale.void':
      return `Voided Rice & LPG sale of ${peso(b.total || a.total)}${forWho}`;
    case 'membership.start':
      return `Filled in the membership application${forWho}`;
    case 'membership.complete':
      return `Became a member (membership fee paid)${forWho}`;
    case 'membership.revoke':
      return `Removed membership${forWho}`;
    case 'reading.create':
      return `Entered the ${a.period ? periodLabel(txt(a.period)) : ''} meter reading: ${reading(a)}${forWho}`;
    case 'reading.correct':
      return `Corrected a meter reading: was ${txt(b.currentReading)}, now ${reading(a)}${forWho}`;
    case 'bills.print':
      return `Printed ${txt(a.count)} water ${a.count === 1 ? 'bill' : 'bills'}`;
    case 'account.create':
      return `Added account ${txt(a.accountNumber)} · ${txt(a.fullName)}`;
    case 'account.update':
      return `Edited the account details${forWho}`;
    case 'connection.create':
      return `Added a water connection${forWho}`;
    case 'connection.status':
      return `Changed a water connection to "${WORDS[txt(a.status)] ?? txt(a.status)}"${forWho}`;
    case 'user.create':
      return `Added user ${txt(a.name)} (${WORDS[txt(a.role)] ?? txt(a.role)})`;
    case 'user.update':
      return `Edited user ${txt(a.name || b.name)}`;
    case 'user.update+password':
      return `Edited user ${txt(a.name || b.name)} and set a new password`;
    case 'user.change-password':
      return 'Changed their own password';
    case 'user.access-grant':
    case 'user.access-remove':
    case 'user.access-expire': {
      const name = (entry.entityId && names.userName(Number(entry.entityId))) || 'a user';
      const work = txt(a.workLabel || b.workLabel);
      if (entry.action === 'user.access-grant') {
        const until = a.endsOn ? `until ${day.format(new Date(`${txt(a.endsOn)}T00:00:00Z`))}` : 'with no end date';
        return `Gave ${name} extra access: ${work} (${until}) · requested by ${txt(a.requestedBy)}`;
      }
      if (entry.action === 'user.access-expire') return `Extra access ended on its end date: ${name} · ${work}`;
      return `Removed extra access from ${name}: ${work}`;
    }
    case 'system.go-live':
      return 'Go-live cleanup: removed the demo data and started this Audit Log';
    case 'login':
      return 'Logged in';
    case 'logout':
      return 'Logged out';
    case 'login.failed':
      return `Failed login for ${txt(a.email)} (${txt(a.reason)})`;
    case 'access.denied':
      return `Was blocked: tried an action their role does not allow (${txt(a.path)})`;
    case 'page.blocked':
      return `Was blocked from opening a page their role does not allow (${txt(a.path)})`;
    case 'settings.update':
      return `Changed settings: ${changesOf(entry.before, entry.after).filter((c) => c.field !== 'reason').map((c) => c.label).join(', ') || 'no change'}`;
    case 'area.create':
      return `Added area ${txt(a.name)}`;
    case 'area.rename':
      return `Renamed area ${txt(b.name)} to ${txt(a.name)}`;
    case 'rates.create':
    case 'rates.replace':
      return `Set new water rates (${WORDS[txt(a.rateClass)] ?? txt(a.rateClass).toLowerCase()}) from ${a.effectiveFrom ? periodLabel(txt(a.effectiveFrom)) : ''}`;
    case 'product.create':
      return `Added product ${txt(a.name)}`;
    case 'product.update':
      return `Edited product ${txt(a.name || b.name)}`;
    case 'product-unit.create':
      return `Added a way to sell: ${txt(a.label)} at ${peso(a.price)}`;
    case 'product-unit.update':
      return `Edited ${txt(a.label || b.label)}`;
    case 'price.change':
      return `Changed the price of ${txt(a.label || b.label)}: ${peso(b.price)} → ${peso(a.price)}`;
    case 'signature.upload':
    case 'signature.replace':
      return `${entry.action === 'signature.upload' ? 'Uploaded' : 'Replaced'} the signature for ${txt(entry.entityId)}`;
    case 'signature.remove':
      return `Removed the signature for ${txt(entry.entityId)}`;
    case 'signature.print-on':
    case 'signature.print-off':
      return `Turned ${entry.action.endsWith('on') ? 'on' : 'off'} printing the signature for ${txt(entry.entityId)}`;
    default: {
      if (entry.entity === 'user' && entry.entityId) {
        const name = names.userName(Number(entry.entityId));
        if (name) return `${entry.action} · ${name}`;
      }
      return entry.action;
    }
  }
}

function reasonOf(entry: AuditLog): string {
  const a = (isObject(entry.after) ? entry.after : {}) as Json;
  if (entry.action === 'user.access-remove' || entry.action === 'user.access-expire') return txt(a.removeReason || '').trim();
  return txt(a.voidReason || a.cancelReason || a.reason || '').trim();
}

// ---- The list -----------------------------------------------------------------------------------

export interface AuditFilters {
  from?: string;
  to?: string;
  userId?: number;
  category?: AuditCategory;
  accountId?: number;
  before?: number;
  limit?: number;
}

/** Everything recorded about one account: the account itself, its connections, readings, payments, sales and invoices. */
async function accountScope(accountId: number): Promise<Prisma.AuditLogWhereInput> {
  const [connections, payments, sales, invoices] = await Promise.all([
    prisma.waterConnection.findMany({ where: { accountId }, select: { id: true } }),
    prisma.payment.findMany({ where: { accountId }, select: { id: true } }),
    prisma.sale.findMany({ where: { accountId }, select: { id: true } }),
    prisma.invoice.findMany({ where: { accountId }, select: { id: true } }),
  ]);
  const bills = await prisma.waterBill.findMany({ where: { connectionId: { in: connections.map((c) => c.id) } }, select: { id: true } });
  const ids = (rows: { id: number }[]) => rows.map((r) => String(r.id));
  return {
    OR: [
      { entity: 'account', entityId: String(accountId) },
      { entity: 'connection', entityId: { in: ids(connections) } },
      { entity: 'water_bill', entityId: { in: ids(bills) } },
      { entity: 'payment', entityId: { in: ids(payments) } },
      { entity: 'sale', entityId: { in: ids(sales) } },
      { entity: 'invoice', entityId: { in: ids(invoices) } },
    ],
  };
}

export async function listAudit(filters: AuditFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where: Prisma.AuditLogWhereInput[] = [];
  // Dates are Philippine calendar days.
  if (filters.from) where.push({ createdAt: { gte: new Date(`${filters.from}T00:00:00+08:00`) } });
  if (filters.to) where.push({ createdAt: { lt: new Date(new Date(`${filters.to}T00:00:00+08:00`).getTime() + 86_400_000) } });
  if (filters.userId) where.push({ userId: filters.userId });
  if (filters.category) where.push({ OR: AUDIT_CATEGORIES[filters.category].prefixes.map((p) => ({ action: { startsWith: p } })) });
  if (filters.accountId) where.push(await accountScope(filters.accountId));
  if (filters.before) where.push({ id: { lt: filters.before } });

  const rows = await prisma.auditLog.findMany({
    where: where.length ? { AND: where } : {},
    orderBy: { id: 'desc' },
    take: limit + 1,
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  const page = rows.slice(0, limit);

  // Look up the account each entry is about, in a few queries for the whole page.
  const idsFor = (entity: string) => page.filter((r) => r.entity === entity && r.entityId).map((r) => Number(r.entityId)).filter(Number.isInteger);
  const accountIdOf = (r: AuditLog): number | null => {
    for (const side of [r.after, r.before]) {
      if (isObject(side) && typeof side.accountId === 'number') return side.accountId;
    }
    return r.entity === 'account' && r.entityId ? Number(r.entityId) : null;
  };
  const [connections, bills] = await Promise.all([
    prisma.waterConnection.findMany({ where: { id: { in: idsFor('connection') } }, select: { id: true, accountId: true } }),
    prisma.waterBill.findMany({ where: { id: { in: idsFor('water_bill') } }, select: { id: true, connection: { select: { accountId: true } } } }),
  ]);
  const connAccount = new Map(connections.map((c) => [c.id, c.accountId]));
  const billAccount = new Map(bills.map((b) => [b.id, b.connection.accountId]));
  const resolve = (r: AuditLog): number | null => {
    if (r.entity === 'connection' && r.entityId) return connAccount.get(Number(r.entityId)) ?? accountIdOf(r);
    if (r.entity === 'water_bill' && r.entityId) return billAccount.get(Number(r.entityId)) ?? null;
    return accountIdOf(r);
  };
  const accountIds = [...new Set(page.map(resolve).filter((v): v is number => v !== null))];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, fullName: true, accountNumber: true } });
  const accountName = new Map(accounts.map((a) => [a.id, `${a.fullName} (${a.accountNumber})`]));
  const userIds = idsFor('user');
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const names: Names = {
    accountOf: (r) => {
      const id = resolve(r);
      return id && accountName.has(id) ? { id, name: accountName.get(id)! } : null;
    },
    userName: (id) => userName.get(id) ?? null,
  };

  return {
    entries: page.map((r) => {
      const account = names.accountOf(r);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        user: r.user,
        action: r.action,
        category: categoryOf(r.action),
        summary: summarize(r, names),
        reason: reasonOf(r),
        account,
        changes: changesOf(r.before, r.after).filter((c) => c.field !== 'reason' && c.field !== 'voidReason' && c.field !== 'cancelReason'),
        isNew: r.before === null,
      };
    }),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}
