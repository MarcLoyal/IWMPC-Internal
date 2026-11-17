export type Role = 'ADMIN' | 'CASHIER' | 'STAFF' | 'BOARD';
export type PaymentType = 'WATER_BILL' | 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'SHARE_CAPITAL' | 'RICE_LPG' | 'OTHER';
export type BillStatus = 'PAID' | 'UNPAID' | 'DUE_SOON' | 'OVERDUE';
export type RateClass = 'RESIDENTIAL' | 'COMMERCIAL';

export interface RateSchedule {
  id: number;
  rateClass: RateClass;
  effectiveFrom: string;
  minimumCharge: string;
  minimumCoversM3: number;
  tiers: { upTo: number | null; rate: string }[];
  method: 'BLOCK' | 'PROGRESSIVE';
  note: string;
  changedBy?: string | null;
  changedAt?: string;
  billCount?: number;
}

/** One row of the customer card. */
export interface WaterBill {
  id: number;
  connectionId: number;
  period: string;
  readDate: string;
  previousReading: number;
  currentReading: number;
  cubicMeters: number;
  amount: string;
  penalty: string;
  paid: string;
  balance: string;
  dueDate: string;
  status: BillStatus;
  datePaid: string | null;
  orNumbers: string[];
}

export interface WaterSummary {
  current: { period: string; amount: string; balance: string; status: BillStatus } | null;
  months: { period: string; status: BillStatus | 'NONE'; amount: string | null; datePaid: string | null }[];
  previousUnpaid: string;
}

/** A way a product is sold, with its price. */
export interface ProductUnit {
  id: number;
  label: string;
  price: string;
  memberPrice: string | null;
  active: boolean;
}

export type ProductKind = 'RICE' | 'LPG' | 'OTHER';

export const KIND_LABEL: Record<ProductKind, string> = { RICE: 'Rice', LPG: 'LPG', OTHER: 'Other' };

export interface Product {
  id: number;
  name: string;
  category: ProductKind;
  active: boolean;
  units: ProductUnit[];
}

/** One line of a Rice & LPG sale, as it was at the time of sale. */
export interface SaleLine {
  productName: string;
  unitLabel: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface Purchase extends SaleLine {
  category: ProductKind;
  saleId: number;
  date: string;
  status: 'ACTIVE' | 'VOID';
  isCredit: boolean;
  balance: string;
  orNumbers: string[];
}

export interface PriceChange {
  id: number;
  unit: string;
  oldPrice: string | null;
  newPrice: string;
  oldMemberPrice: string | null;
  newMemberPrice: string | null;
  reason: string;
  changedBy: string | null;
  changedAt: string;
}

export type Sex = 'MALE' | 'FEMALE';
export type BoardDecision = 'APPROVED' | 'DISAPPROVED';
export type ConnectionStatus = 'PENDING_INSTALLATION' | 'ACTIVE' | 'DISCONNECTED';
export type CivilStatus = 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'SEPARATED';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Area {
  id: number;
  name: string;
}

export interface AccountRow {
  id: number;
  accountNumber: string;
  memberNumber: string | null;
  fullName: string;
  area: string;
  areaId: number;
  isMember: boolean;
  membershipStatus: 'NONE' | 'PENDING' | 'MEMBER';
  connectionState?: 'NONE' | 'PENDING' | 'INSTALLED';
  lastPurchase?: { date: string; item: string; moreItems: number; amount: string } | null;
  water?: WaterSummary;
}

export interface Beneficiary {
  id?: number;
  name: string;
  relationship: string;
}

export interface AccountDetail extends AccountRow {
  lastName: string;
  firstName: string;
  middleName: string;
  purok: string;
  barangay: string;
  municipality: string;
  province: string;
  tin: string;
  sex: Sex | null;
  religion: string;
  education: string;
  membershipAppliedOn: string | null;
  membershipPurpose: string;
  sharesSubscribed: number | null;
  sharesAmount: string | null;
  meterRegisteredName: string;
  pmesAttended: boolean | null;
  boardDecision: BoardDecision | null;
  boardDecisionDate: string | null;
  address: string;
  phone: string;
  birthDate: string | null;
  civilStatus: CivilStatus | null;
  idType: string;
  idNumber: string;
  memberSince: string | null;
  dateRegistered: string;
  beneficiaries: Beneficiary[];
}

export interface Connection {
  id: number;
  connectionNumber: string;
  applicationDate: string | null;
  meterName: string;
  meterSerial: string;
  remarks: string;
  address: string;
  rateClass: RateClass;
  initialReading: number;
  installationDate: string | null;
  status: ConnectionStatus;
}

export interface Payment {
  id: number;
  /** Empty for a walk-in Rice & LPG sale. */
  accountId: number | null;
  walkIn?: boolean;
  saleId?: number | null;
  items?: SaleLine[];
  accountName?: string;
  accountNumber?: string;
  type: PaymentType;
  amount: string;
  orNumber: string;
  waterBillPeriod?: string | null;
  paymentDate: string;
  description: string;
  status: 'ACTIVE' | 'VOID';
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface OwedItem {
  type: PaymentType;
  label: string;
  amount: string;
  waterBillId?: number;
  saleId?: number;
  status?: BillStatus;
}

export interface AccountProfile {
  account: AccountDetail;
  connections: Connection[];
  payments: Payment[];
  bills: WaterBill[];
  purchases: Purchase[];
  riceLpg: { year: string; totalThisYear: string; riceThisYear: string; lpgThisYear: string; otherThisYear: string; creditBalance: string };
  water: { hasBills: boolean; totalDue: string; status: BillStatus; nextDueDate: string | null; unpaidMonths: number };
  owed: OwedItem[];
  warnings: string[];
  canMakeMember: boolean;
}

export interface AccountList {
  rows: AccountRow[];
  total: number;
  months: string[];
  years: string[];
  counts: {
    type: { all: number; members: number; nonMembers: number };
    areas: { id: number; name: string; count: number }[];
    allAreas: number;
  };
}

export interface Settings {
  coop_name: string;
  coop_address: string;
  coop_cda_no: string;
  water_due_days: string;
  water_due_rule: 'DAY_OF_NEXT_MONTH' | 'DAYS_AFTER_READING';
  water_due_day: string;
  coop_phone: string;
  coop_mobile: string;
  bill_paper: 'LETTER' | 'LONG';
  bill_preparer_name: string;
  bill_preparer_title: string;
  bill_cashier_name: string;
  bill_cashier_title: string;
  bill_manager_name: string;
  bill_manager_title: string;
  sig_bill_preparer_on: string;
  sig_bill_cashier_on: string;
  sig_bill_manager_on: string;
  sig_notice_preparer_on: string;
  sig_notice_cashier_on: string;
  sig_notice_manager_on: string;
  notice_phone_line: string;
  notice_preparer_name: string;
  notice_preparer_title: string;
  notice_cashier_name: string;
  notice_cashier_title: string;
  notice_manager_name: string;
  notice_manager_title: string;
  notice_threshold_months: string;
  notice_per_page: string;
  disconnect_days_after_due: string;
  reconnection_fee: string;
  water_penalty_type: 'PERCENT' | 'FIXED';
  water_penalty_value: string;
  water_disconnect_months: string;
  allow_credit: 'true' | 'false';
  membership_fee: string;
  installation_fee: string;
  account_no_prefix: string;
  account_no_padding: string;
  account_no_next: string;
  member_no_prefix: string;
  member_no_padding: string;
  member_no_next: string;
  nextAccountNumber: string;
  nextMemberNumber: string;
}

export interface HomeSummary {
  today: string;
  collections: { total: string; count: number };
  accounts: { total: number; members: number; nonMembers: number };
  overdueWater: { count: number; total: string };
}

export interface DailyReport {
  date: string;
  coop: { name: string; address: string; cdaNo: string };
  payments: Payment[];
  totals: { type: PaymentType; count: number; total: string }[];
  grandTotal: string;
  count: number;
  voidedCount: number;
  riceLpg: { lines: { product: string; unit: string; quantity: string; amount: string }[]; creditCollected: string };
  orGaps: { after: string; before: string; missing: string[]; missingCount: number }[];
}
