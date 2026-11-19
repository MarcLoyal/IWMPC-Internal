import { Prisma } from '@prisma/client';
import { AppError, notFound } from '../lib/errors';
import { toDbDate, todayManila } from '../lib/dates';
import { audit } from './audit';
import { nextNumber } from './numbering';

/*
 * The only code allowed to change is_member / membership_status.
 *
 *   NONE or NOT_APPROVED --(Staff: Submit Membership Application)--> FOR_APPROVAL
 *   FOR_APPROVAL --(Admin records the Board's decision: approved)--> PENDING ("Approved – waiting for fee")
 *   FOR_APPROVAL --(Admin records the Board's decision: not approved)--> NOT_APPROVED
 *   PENDING --(Cashier: membership fee paid in full)--> MEMBER
 *   MEMBER --(membership fee payment voided)--> PENDING   (the approval stands; member number stays reserved)
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

/** The account columns filled in from the Application for Membership form. */
export type MembershipDetails = Pick<
  Prisma.AccountUncheckedUpdateInput,
  | 'membershipAppliedOn'
  | 'membershipPurpose'
  | 'sharesSubscribed'
  | 'sharesAmount'
  | 'meterRegisteredName'
  | 'pmesAttended'
  | 'boardDecision'
  | 'boardDecisionDate'
>;

/** Why an application cannot be submitted now, or null if it can. */
export function cannotApply(status: string, isMember: boolean): string | null {
  if (isMember || status === 'MEMBER') return 'This account is already a member.';
  if (status === 'FOR_APPROVAL') return "This account's membership application is already waiting for the Admin's approval.";
  if (status === 'PENDING') return 'This membership application was already approved and is waiting for the membership fee.';
  return null;
}

/**
 * Step 1: Staff submit the Application for Membership. It waits for the Admin to record the
 * Board's decision; no fee can be received yet. Also used to apply again after "Not approved".
 */
export async function startMembership(
  tx: Prisma.TransactionClient,
  accountId: number,
  beneficiaries: BeneficiaryInput[],
  userId: number,
  details: MembershipDetails = {},
) {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account) throw notFound('This account');
  const problem = cannotApply(account.membershipStatus, account.isMember);
  if (problem) throw new AppError(400, problem);
  if (!(await hasActiveConnection(tx, accountId))) throw new AppError(400, NO_ACTIVE_CONNECTION);

  await tx.beneficiary.deleteMany({ where: { accountId } });
  if (beneficiaries.length) {
    await tx.beneficiary.createMany({ data: beneficiaries.map((b) => ({ ...b, accountId })) });
  }
  // The Board's decision is recorded only by the Admin, never from the application form.
  const { boardDecision: _d, boardDecisionDate: _dd, ...fromForm } = details;
  const appliedOn = (fromForm.membershipAppliedOn as Date | undefined) ?? toDbDate(todayManila());
  const updated = await tx.account.update({
    where: { id: accountId },
    data: { ...fromForm, membershipAppliedOn: appliedOn, boardDecision: null, boardDecisionDate: null, membershipStatus: 'FOR_APPROVAL' },
  });
  const application = await tx.membershipApplication.create({ data: { accountId, appliedOn, submittedById: userId } });
  await audit(tx, userId, 'membership.start', 'account', accountId, { membershipStatus: account.membershipStatus }, {
    membershipStatus: 'FOR_APPROVAL',
    applicationId: application.id,
    ...fromForm,
    beneficiaries,
  });
  return updated;
}

export interface MembershipDecisionInput {
  decision: 'APPROVED' | 'DISAPPROVED';
  /** The date of the Board's decision (YYYY-MM-DD). */
  boardDecisionDate: string;
  /** Board resolution or meeting no. (optional). */
  reference: string;
  /** Required when not approved. */
  reason: string;
}

/** Step 2 (Admin only): records the Board's decision on the waiting application. */
export async function decideMembership(tx: Prisma.TransactionClient, accountId: number, input: MembershipDecisionInput, adminId: number) {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account) throw notFound('This account');
  if (account.membershipStatus !== 'FOR_APPROVAL') {
    throw new AppError(400, 'This account has no membership application waiting for approval.');
  }
  if (input.boardDecisionDate > todayManila()) throw new AppError(400, 'The date of the Board decision cannot be in the future.');
  const reason = input.reason.trim();
  if (input.decision === 'DISAPPROVED' && !reason) throw new AppError(400, 'Please type the reason the application was not approved.');
  const application = await tx.membershipApplication.findFirst({
    where: { accountId, decision: null },
    orderBy: { id: 'desc' },
  });
  if (!application) throw new AppError(400, 'This account has no membership application waiting for approval.');

  const approved = input.decision === 'APPROVED';
  const date = toDbDate(input.boardDecisionDate);
  await tx.membershipApplication.update({
    where: { id: application.id },
    data: {
      decision: input.decision,
      boardDecisionDate: date,
      reference: input.reference.trim(),
      reason: approved ? '' : reason,
      decidedAt: new Date(),
      decidedById: adminId,
    },
  });
  const status = approved ? 'PENDING' : 'NOT_APPROVED';
  await tx.account.update({
    where: { id: accountId },
    data: { membershipStatus: status, boardDecision: input.decision, boardDecisionDate: date },
  });
  await audit(
    tx,
    adminId,
    approved ? 'membership.approve' : 'membership.not-approved',
    'account',
    accountId,
    { membershipStatus: account.membershipStatus },
    { membershipStatus: status, boardDecisionDate: input.boardDecisionDate, reference: input.reference.trim(), reason: approved ? '' : reason },
  );
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
  if (account.membershipStatus === 'FOR_APPROVAL') {
    throw new AppError(400, "This membership application is waiting for the Admin's approval. The membership fee can be received only after it is approved.");
  }
  if (account.membershipStatus === 'NOT_APPROVED') {
    throw new AppError(400, 'This membership application was not approved by the Board, so no membership fee can be received.');
  }
  if (account.membershipStatus !== 'PENDING') {
    throw new AppError(400, 'There is no approved membership application for this account. Staff submit the application first, then the Admin approves it.');
  }
  // Re-checked here on the server: hiding the button is not enough.
  if (!(await hasActiveConnection(tx, accountId))) throw new AppError(400, NO_ACTIVE_CONNECTION);
  // Paying more than the fee is allowed; paying less is not.
  if (amount.lt(fee)) {
    throw new AppError(400, `The membership fee must be paid in full: at least ₱${fee.toFixed(2)}.`);
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

/**
 * The membership fee payment was voided: no longer a member, but the Board's approval still stands,
 * so the account goes back to "Approved – waiting for fee". The member number is kept and never reused.
 */
export async function revokeMembership(tx: Prisma.TransactionClient, accountId: number, userId: number) {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!account.isMember) return;
  await tx.account.update({
    where: { id: accountId },
    data: { isMember: false, membershipStatus: 'PENDING', memberSince: null },
  });
  await audit(tx, userId, 'membership.revoke', 'account', accountId, { isMember: true }, { isMember: false, membershipStatus: 'PENDING' });
}
