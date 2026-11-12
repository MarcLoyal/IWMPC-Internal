import type { Account, Area, Beneficiary, Payment, User, WaterConnection } from '@prisma/client';
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
    address: a.address,
    phone: a.phone,
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
    address: c.address,
    rateClass: c.rateClass,
    installationDate: fromDbDate(c.installationDate),
    status: c.status,
  };
}

type PaymentWithPeople = Payment & {
  createdBy?: Pick<User, 'name'> | null;
  voidedBy?: Pick<User, 'name'> | null;
  account?: Pick<Account, 'id' | 'fullName' | 'accountNumber'> | null;
};

export function paymentJson(p: PaymentWithPeople) {
  return {
    id: p.id,
    accountId: p.accountId,
    accountName: p.account?.fullName,
    accountNumber: p.account?.accountNumber,
    type: p.type,
    amount: p.amount.toFixed(2),
    orNumber: p.orNumber,
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
