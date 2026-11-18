import type { Db } from '../lib/prisma';

/** Every setting, with the value used until an admin changes it. */
export const SETTING_DEFAULTS = {
  coop_name: 'Inicbulan Waterworks Multi-purpose Cooperative',
  coop_address: 'Inicbulan, Bauan, Batangas',
  coop_cda_no: '9520-04002341',
  coop_phone: '(043) 740-0767',
  // BIR Service Invoice booklet (handwritten; the system only shows a guide).
  invoice_tin_line: 'NON VAT Reg. TIN-272-721-784-00000',
  invoice_phone_line: 'Tel. No. (043) 740-0767 / 0910-491-8512',
  invoice_atp_no: '058AU20260000008873',
  invoice_atp_date: '2026-05-13',
  invoice_series_from: '25001',
  invoice_series_to: '40000',
  coop_mobile: '0910-4918-512',
  // Printed bills: paper size and the three signatories.
  bill_paper: 'LETTER',
  bill_preparer_name: 'Alffa M. Mahiya',
  bill_preparer_title: 'Billing Officer',
  bill_cashier_name: 'Emard B. Ramos',
  bill_cashier_title: 'Cashier',
  bill_manager_name: 'Marino R. Abanador',
  bill_manager_title: 'General Manager',
  // Printing a signature image above each name ('true' / 'false'), per form and signatory.
  sig_bill_preparer_on: 'true',
  sig_bill_cashier_on: 'true',
  sig_bill_manager_on: 'true',
  sig_notice_preparer_on: 'true',
  sig_notice_cashier_on: 'true',
  sig_notice_manager_on: 'true',
  // The 2-month unpaid notice.
  notice_phone_line: 'Tel. No. 043 740-0767   Mobile No. +63910 491 8512',
  notice_preparer_name: 'Maria B. Ilagan',
  notice_preparer_title: 'Billing Officer',
  notice_cashier_name: 'Emard B. Ramos',
  notice_cashier_title: 'Cashier/Collector',
  notice_manager_name: 'Marino R. Abanador',
  notice_manager_title: 'General Manager',
  notice_threshold_months: '2',
  notice_per_page: '1',
  disconnect_days_after_due: '5',
  reconnection_fee: '1000.00',
  membership_fee: '0.00',
  installation_fee: '0.00',
  // Water billing. These apply to bills created from now on; existing bills keep their own terms.
  // How a new bill's due date is set: 'DAY_OF_NEXT_MONTH' = day water_due_day of the month after the
  // billing month (an October reading is due November 15), or 'DAYS_AFTER_READING' = water_due_days
  // after the reading date. Bills already made keep their own due date.
  water_due_rule: 'DAY_OF_NEXT_MONTH',
  water_due_day: '15',
  water_due_days: '15',
  water_penalty_type: 'PERCENT',
  water_penalty_value: '10',
  water_disconnect_months: '2',
  // Rice & LPG: selling on credit (utang). Off unless an Admin turns it on.
  allow_credit: 'false',
  account_no_prefix: 'A-',
  account_no_padding: '4',
  account_no_next: '1',
  member_no_prefix: '',
  member_no_padding: '4',
  member_no_next: '1',
  // Loans. A member can borrow up to loan_limit_percent of their paid-up share capital, less the
  // principal still unpaid on their other loans.
  loan_limit_percent: '70',
  // Paying a loan off early: 'THIS_MONTH' = principal left + this month's interest in full,
  // 'TO_DATE' = principal left + this month's interest for the days so far.
  loan_payoff_rule: 'THIS_MONTH',
  loan_no_prefix: 'LN-',
  loan_no_padding: '5',
  loan_no_next: '1',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/** Money settings: changing one needs a reason, and each change is kept in the setting history. */
export const MONEY_SETTINGS: SettingKey[] = ['water_penalty_type', 'water_penalty_value', 'reconnection_fee', 'loan_limit_percent', 'loan_payoff_rule'];

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.setting.findMany();
  const result: Settings = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (row.key in SETTING_DEFAULTS) result[row.key as SettingKey] = row.value;
  }
  return result;
}

export async function ensureDefaultSettings(db: Db) {
  for (const key of SETTING_KEYS) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value: SETTING_DEFAULTS[key] } });
  }
  // Coop details printed on IWMPC's own forms: fill them in if they were left blank.
  for (const key of ['coop_address', 'coop_cda_no'] as const) {
    await db.setting.updateMany({ where: { key, value: '' }, data: { value: SETTING_DEFAULTS[key] } });
  }
}
