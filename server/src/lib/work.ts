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
} as const;

export type Work = keyof typeof WORK;
export const WORK_KEYS = Object.keys(WORK) as Work[];

/** The work each role does without any extra access. */
export const ROLE_WORK: Record<Role, Work[]> = {
  ADMIN: [...WORK_KEYS],
  CASHIER: ['CASHIER', 'PRINT'],
  STAFF: ['READINGS', 'ACCOUNTS', 'PRINT'],
  BOARD: [],
};

/** Roles that can be given extra access. Admins already have everything; Board stays view only. */
export const CAN_GET_EXTRA: Role[] = ['CASHIER', 'STAFF'];
