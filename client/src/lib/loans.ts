/** Loans (Phase 1C): what the server sends, and the words and colors the screens use. */

export type LoanStatus = 'FOR_APPROVAL' | 'APPROVED' | 'RELEASED' | 'PAID' | 'REJECTED' | 'CANCELLED';
export type Standing = 'PAID' | 'OVERDUE' | 'DUE_SOON' | 'UP_TO_DATE' | 'NOT_RELEASED';
export type InstallmentStatus = 'PAID' | 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'NOT_RELEASED';
type Tone = 'green' | 'yellow' | 'red' | 'gray' | 'blue';

export const LOAN_STATUS: Record<LoanStatus, { label: string; tone: Tone }> = {
  FOR_APPROVAL: { label: 'For approval', tone: 'yellow' },
  APPROVED: { label: 'Approved · ready to release', tone: 'blue' },
  RELEASED: { label: 'Active', tone: 'blue' },
  PAID: { label: 'Paid', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'gray' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};

export const STANDING: Record<Standing, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  DUE_SOON: { label: 'Due soon', tone: 'yellow' },
  UP_TO_DATE: { label: 'Up to date', tone: 'green' },
  NOT_RELEASED: { label: 'Not released', tone: 'gray' },
};

export const INSTALLMENT: Record<InstallmentStatus, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  DUE_SOON: { label: 'Due soon', tone: 'yellow' },
  UPCOMING: { label: 'Not yet due', tone: 'gray' },
  NOT_RELEASED: { label: '—', tone: 'gray' },
};

/** The left border of a loan card: green paid, yellow due soon, red overdue. */
export const STANDING_BORDER: Record<Standing, string> = {
  PAID: 'border-l-emerald-600',
  UP_TO_DATE: 'border-l-emerald-600',
  DUE_SOON: 'border-l-amber-400',
  OVERDUE: 'border-l-red-600',
  NOT_RELEASED: 'border-l-slate-300',
};

export interface LoanType {
  id: number;
  name: string;
  monthlyRate: string;
  method: string;
  minMonths: number;
  maxMonths: number;
  serviceChargePercent: string;
  tscType: 'AMOUNT' | 'PERCENT';
  tscValue: string;
  notarialFee: string;
  otherChargeLabel: string;
  otherChargeAmount: string;
  penaltyType: 'NONE' | 'PERCENT' | 'AMOUNT';
  penaltyValue: string;
  active: boolean;
}

export interface Limit {
  isMember: boolean;
  percent: number;
  paidUp: string;
  /** Where the share capital comes from. */
  shareCapital?: { opening: string; fromMembership: string; fromPayments: string };
  ofShares: string;
  inUse: string;
  limit: string;
}

/** "₱4,000.00 from the membership payment · ₱1,000.00 Share Capital payments · …" (only the parts above zero). */
export function shareCapitalParts(c: Limit['shareCapital']): string {
  if (!c) return '';
  const peso = (v: string) => `₱${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return [
    Number(c.fromMembership) > 0 && `${peso(c.fromMembership)} from the membership payment`,
    Number(c.fromPayments) > 0 && `${peso(c.fromPayments)} Share Capital payments`,
    Number(c.opening) > 0 && `${peso(c.opening)} from before the system`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface ScheduleRow {
  no: number;
  dueDate: string;
  principal: string;
  interest: string;
  amount: string;
  balanceAfter: string;
}

export interface Quote {
  loanType: LoanType;
  principal: string;
  monthlyRate: string;
  months: number;
  monthlyPayment: string;
  totalInterest: string;
  totalToPay: string;
  deductions: { label: string; amount: string }[];
  totalDeductions: string;
  netCash: string;
  effectiveRate: string;
  schedule: ScheduleRow[];
  limit: Limit;
  overLimit: boolean;
}

export interface Loan {
  id: number;
  number: string;
  status: LoanStatus;
  standing: Standing;
  account: { id: number; fullName: string; accountNumber: string; memberNumber: string | null; address: string; area: string };
  typeName: string;
  monthlyRate: string;
  months: number;
  principal: string;
  monthlyPayment: string;
  totalInterest: string;
  totalToPay: string;
  deductions: { label: string; amount: string }[];
  totalDeductions: string;
  netCash: string;
  effectiveRate: string;
  penaltyType: string;
  penaltyValue: string;
  purpose: string;
  limitAtApply: string;
  overLimitReason: string | null;
  createdAt: string;
  createdBy: string | null;
  createdById: number;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
  releaseDate: string | null;
  releasedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  paidOn: string | null;
  dueDate: string | null;
  balance: string;
  totalOwed: string;
  overdueAmount: string;
  overdueCount: number;
  next: { no: number; dueDate: string; amount: string } | null;
  dueNow: string;
  paidSoFar: string;
  payoff: { rule: 'THIS_MONTH' | 'TO_DATE'; amount: string } | null;
  schedule: (ScheduleRow & { paid: string; penaltyOwed: string; status: InstallmentStatus })[];
  payments: { id: number; date: string; number: string; status: 'ACTIVE' | 'VOID'; amount: string; penalty: string; interest: string; principal: string }[];
}

export interface LoanRow {
  id: number;
  number: string;
  status: LoanStatus;
  standing: Standing;
  account: { id: number; fullName: string; accountNumber: string; area: string; areaId: number };
  typeName: string;
  principal: string;
  monthlyPayment: string;
  months: number;
  balance: string;
  next: { no: number; dueDate: string; amount: string } | null;
  overdueAmount: string;
  overdueCount: number;
  oldestOverdue: string | null;
  dueThisWeek: string;
  createdAt: string;
  releaseDate: string | null;
  phone: string;
}

export interface MemberLoans {
  account: { id: number; fullName: string; accountNumber: string; memberNumber: string | null; area: string; isMember: boolean; openingShareCapital: string };
  limit: Limit;
  loans: Loan[];
}

export interface LoanSummary {
  active: { count: number; balance: string };
  dueThisWeek: { count: number; amount: string };
  overdue: { count: number; amount: string };
  forApproval: number | null;
  readyToRelease: number | null;
}

export const PAYOFF_RULE = {
  THIS_MONTH: 'Principal left + this month’s interest',
  TO_DATE: 'Principal left + this month’s interest for the days so far',
} as const;
