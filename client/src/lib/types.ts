export type Role = 'ADMIN' | 'CASHIER' | 'STAFF' | 'BOARD';
export type PaymentType = 'WATER_BILL' | 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'SHARE_CAPITAL' | 'OTHER';
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
  accountId: number;
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
  status?: BillStatus;
}

export interface AccountProfile {
  account: AccountDetail;
  connections: Connection[];
  payments: Payment[];
  bills: WaterBill[];
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
  water_penalty_type: 'PERCENT' | 'FIXED';
  water_penalty_value: string;
  water_disconnect_months: string;
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
  orGaps: { after: string; before: string; missing: string[]; missingCount: number }[];
}
