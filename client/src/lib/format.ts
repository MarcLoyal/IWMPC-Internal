import type { CivilStatus, ConnectionStatus, PaymentType, Role } from './types';

/** Money is always shown as ₱ with commas and two decimals: ₱1,250.00 */
export function peso(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₱0.00';
  return '₱' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2026-11-12" or an ISO timestamp -> "Nov 12, 2026" (Philippine date). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return d.toLocaleDateString('en-US', {
    timeZone: dateOnly ? 'UTC' : 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatLongDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export const PAYMENT_TYPE: Record<PaymentType, string> = {
  WATER_BILL: 'Water Bill',
  INSTALLATION_FEE: 'Installation Fee',
  MEMBERSHIP_FEE: 'Membership Fee',
  SHARE_CAPITAL: 'Share Capital',
  RICE_LPG: 'Rice & LPG',
  OTHER: 'Other',
  LOAN: 'Loan Payment',
};

export const CONNECTION_STATUS: Record<ConnectionStatus, string> = {
  PENDING_INSTALLATION: 'Pending Installation',
  ACTIVE: 'Active',
  DISCONNECTED: 'Disconnected',
};

export const SEX = { MALE: 'Male', FEMALE: 'Female' } as const;

/** Age in full years from a YYYY-MM-DD birthday. */
export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export const CIVIL_STATUS: Record<CivilStatus, string> = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  WIDOWED: 'Widowed',
  SEPARATED: 'Separated',
};

export const ROLE: Record<Role, string> = {
  ADMIN: 'Admin',
  CASHIER: 'Cashier',
  STAFF: 'Staff / Encoder',
  BOARD: 'Board (view only)',
  LOAN_OFFICER: 'Loan Officer',
};

export const ROLE_CAN: Record<Role, string> = {
  ADMIN: 'Everything, including settings, users and voiding',
  CASHIER: 'Record payments and view accounts',
  STAFF: 'Create and edit accounts and connections',
  BOARD: 'View only',
  LOAN_OFFICER: 'Make loan applications, print schedules, view loans. Cannot approve, release or take payments',
};
