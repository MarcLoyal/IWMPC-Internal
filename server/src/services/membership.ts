import { Prisma } from '@prisma/client';
import { AppError, notFound } from '../lib/errors';
import { toDbDate } from '../lib/dates';
import { audit } from './audit';
import { nextNumber } from './numbering';

/*
 * The only code allowed to change is_member / membership_status.
 *
 *   NONE --(Make a Member)--> PENDING --(membership fee paid)--> MEMBER
 *   MEMBER --(membership fee payment voided)--> NONE   (member number stays reserved)
 */

export const NO_ACTIVE_CONNECTION =
  'This account has no active water connection. Only accounts with an active connection can become members.';

async function hasActiveConnection(tx: Prisma.TransactionClient, accountId: number) {
  return (await tx.waterConnection.count({ where: { accountId, status: 'ACTIVE' } })) > 0;
}

export interface BeneficiaryInput {
  name: string;
  relationship: string;
}

/** Step 1: staff click "Make a Member". The account waits for the membership fee. */
export async function startMembership(
  tx: Prisma.TransactionClient,
  accountId: number,
  beneficiaries: BeneficiaryInput[],
  userId: number,
) {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account) throw notFound('This account');
  if (account.isMember) throw new AppError(400, 'This account is already a member.');
  if (!(await hasActiveConnection(tx, accountId))) throw new AppError(400, NO_ACTIVE_CONNECTION);

  await tx.beneficiary.deleteMany({ where: { accountId } });
  if (beneficiaries.length) {
    await tx.beneficiary.createMany({ data: beneficiaries.map((b) => ({ ...b, accountId })) });
  }
  const updated = await tx.account.update({ where: { id: accountId }, data: { membershipStatus: 'PENDING' } });
  await audit(tx, userId, 'membership.start', 'account', accountId, { membershipStatus: account.membershipStatus }, {
    membershipStatus: 'PENDING',
    beneficiaries,
  });
  return updated;
}

/** Checks done before a membership fee payment is saved. */
export async function assertCanPayMembershipFee(
  tx: Prisma.TransactionClient,
  accountId: number,
  amount: Prisma.Decimal,
  fee: Prisma.Decimal,
) {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account) throw notFound('This account');
  if (account.isMember) throw new AppError(400, 'This account is already a member.');
  if (account.membershipStatus !== 'PENDING') {
    throw new AppError(400, 'Open this account and click "Make a Member" first, then receive the membership fee.');
  }
  // Re-checked here on the server: hiding the button is not enough.
  if (!(await hasActiveConnection(tx, accountId))) throw new AppError(400, NO_ACTIVE_CONNECTION);
  if (!amount.equals(fee)) {
    throw new AppError(400, `The membership fee must be paid in full: ₱${fee.toFixed(2)}.`);
  }
}

/** Step 2: the membership fee was paid. The account becomes a member and gets its member number. */
export async function completeMembership(
  tx: Prisma.TransactionClient,
  accountId: number,
  paymentDate: string,
  userId: number,
) {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  // A returning member keeps the number they had before.
  const memberNumber = account.memberNumber ?? (await nextNumber(tx, 'member'));
  await tx.account.update({
    where: { id: accountId },
    data: { isMember: true, membershipStatus: 'MEMBER', memberSince: toDbDate(paymentDate), memberNumber },
  });
  await audit(tx, userId, 'membership.complete', 'account', accountId, { isMember: false }, {
    isMember: true,
    memberNumber,
  });
}

/** The membership fee payment was voided: back to Non-member. The member number is kept and never reused. */
export async function revokeMembership(tx: Prisma.TransactionClient, accountId: number, userId: number) {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!account.isMember) return;
  await tx.account.update({
    where: { id: accountId },
    data: { isMember: false, membershipStatus: 'NONE', memberSince: null },
  });
  await audit(tx, userId, 'membership.revoke', 'account', accountId, { isMember: true }, { isMember: false });
}
