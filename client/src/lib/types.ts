export type Role = 'ADMIN' | 'CASHIER' | 'STAFF' | 'BOARD';
export type PaymentType = 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'OTHER';
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
}

export interface Beneficiary {
  id?: number;
  name: string;
  relationship: string;
}

export interface AccountDetail extends AccountRow {
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
  address: string;
  rateClass: string;
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
}

export interface AccountProfile {
  account: AccountDetail;
  connections: Connection[];
  payments: Payment[];
  owed: OwedItem[];
  warnings: string[];
  canMakeMember: boolean;
}

export interface AccountList {
  rows: AccountRow[];
  total: number;
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
