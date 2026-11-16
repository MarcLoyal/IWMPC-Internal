import type { Account, Area, Beneficiary, Payment, Sale, SaleItem, User, WaterConnection } from '@prisma/client';
import { fromDbDate } from './dates';

export function accountRow(a: Account & { area: Area }) {
  return {
    id: a.id,
    accountNumber: a.accountNumber,
    // Shown for members only; the number itself stays reserved on the record.
    memberNumber: a.isMember ? a.memberNumber : null,
    fullName: a.fullName,
    area: a.area.name,
    areaId: a.areaId,
    isMember: a.isMember,
    membershipStatus: a.membershipStatus,
  };
}

export function accountDetail(a: Account & { area: Area; beneficiaries: Beneficiary[] }) {
  return {
    ...accountRow(a),
    lastName: a.lastName,
    firstName: a.firstName,
    middleName: a.middleName,
    purok: a.purok,
    barangay: a.barangay,
    municipality: a.municipality,
    province: a.province,
    address: a.address,
    phone: a.phone,
    tin: a.tin,
    sex: a.sex,
    religion: a.religion,
    education: a.education,
    membershipAppliedOn: fromDbDate(a.membershipAppliedOn),
    membershipPurpose: a.membershipPurpose,
    sharesSubscribed: a.sharesSubscribed,
    sharesAmount: a.sharesAmount?.toFixed(2) ?? null,
    meterRegisteredName: a.meterRegisteredName,
    pmesAttended: a.pmesAttended,
    boardDecision: a.boardDecision,
    boardDecisionDate: fromDbDate(a.boardDecisionDate),
    birthDate: fromDbDate(a.birthDate),
    civilStatus: a.civilStatus,
    idType: a.idType,
    idNumber: a.idNumber,
    memberSince: fromDbDate(a.memberSince),
    dateRegistered: a.createdAt.toISOString(),
    beneficiaries: a.beneficiaries.map((b) => ({ id: b.id, name: b.name, relationship: b.relationship })),
  };
}

export function connectionJson(c: WaterConnection) {
  return {
    id: c.id,
    connectionNumber: c.connectionNumber,
    applicationDate: fromDbDate(c.applicationDate),
    meterName: c.meterName,
    meterSerial: c.meterSerial,
    remarks: c.remarks,
    address: c.address,
    rateClass: c.rateClass,
    initialReading: c.initialReading,
    installationDate: fromDbDate(c.installationDate),
    status: c.status,
  };
}

type PaymentWithPeople = Payment & {
  createdBy?: Pick<User, 'name'> | null;
  voidedBy?: Pick<User, 'name'> | null;
  account?: Pick<Account, 'id' | 'fullName' | 'accountNumber'> | null;
  waterBill?: { period: string } | null;
  sale?: (Sale & { items: SaleItem[] }) | null;
};

export function saleItemJson(i: SaleItem) {
  return {
    productName: i.productName,
    unitLabel: i.unitLabel,
    quantity: i.quantity.toDecimalPlaces(2).toString(),
    unitPrice: i.unitPrice.toFixed(2),
    amount: i.amount.toFixed(2),
  };
}

export function paymentJson(p: PaymentWithPeople) {
  return {
    id: p.id,
    accountId: p.accountId,
    // A walk-in Rice & LPG sale has no account.
    accountName: p.account?.fullName ?? (p.accountId === null ? p.sale?.walkInName || 'Walk-in customer' : undefined),
    walkIn: p.accountId === null,
    saleId: p.saleId,
    items: p.sale?.items.map(saleItemJson) ?? [],
    accountNumber: p.account?.accountNumber,
    type: p.type,
    amount: p.amount.toFixed(2),
    orNumber: p.orNumber,
    // For water bill payments: the month that was paid, e.g. "2026-10".
    waterBillPeriod: p.waterBill?.period ?? null,
    paymentDate: fromDbDate(p.paymentDate)!,
    description: p.description,
    status: p.status,
    voidReason: p.voidReason,
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidedBy: p.voidedBy?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    createdBy: p.createdBy?.name ?? null,
  };
}

export function userJson(u: User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status };
}
