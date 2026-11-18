import type { Role } from '@prisma/client';

/**
 * The kinds of work an Admin can give a user beyond their role. Voiding, cancelling, prices,
 * rates, settings and users are deliberately not here: those stay Admin-only.
 */
export const WORK = {
  CASHIER: 'Work the Cashier: receive payments and sell rice & LPG',
  READINGS: 'Encode meter readings',
  ACCOUNTS: 'Add and edit accounts and connections',
  PRINT: 'Print bills and notices',
  LOANS: 'Loan applications: make loans, print schedules and disclosures',
  APPROVE_LOANS: 'Approve or reject loans',
} as const;

export type Work = keyof typeof WORK;
export const WORK_KEYS = Object.keys(WORK) as Work[];

/** The work each role does without any extra access. */
export const ROLE_WORK: Record<Role, Work[]> = {
  ADMIN: [...WORK_KEYS],
  CASHIER: ['CASHIER', 'PRINT'],
  STAFF: ['READINGS', 'ACCOUNTS', 'PRINT'],
  BOARD: [],
  LOAN_OFFICER: ['LOANS'],
};

/** Roles that can be given extra access. Admins already have everything; Board stays view only. */
export const CAN_GET_EXTRA: Role[] = ['CASHIER', 'STAFF', 'LOAN_OFFICER'];

/**
 * Work a role can never be given, to keep duties apart: the person who makes a loan cannot approve
 * it or hand out the cash, and the Cashier who hands out the cash cannot approve loans.
 */
export const NEVER_FOR: Partial<Record<Role, Work[]>> = {
  LOAN_OFFICER: ['APPROVE_LOANS', 'CASHIER'],
  CASHIER: ['APPROVE_LOANS'],
};

export const canBeGiven = (role: Role, work: Work) => CAN_GET_EXTRA.includes(role) && !(NEVER_FOR[role] ?? []).includes(work);
