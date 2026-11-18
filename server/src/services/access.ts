import type { AccessGrant, Prisma, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { fromDbDate, todayManila, toDbDate } from '../lib/dates';
import { ROLE_WORK, WORK, type Work } from '../lib/work';
import { audit } from './audit';

type GrantWithPeople = AccessGrant & { grantedBy: { name: string }; removedBy: { name: string } | null };

/** A grant still counts through the whole of its end date (Philippine time). */
export function isPastEnd(grant: Pick<AccessGrant, 'endsOn'>, today = todayManila()): boolean {
  return !!grant.endsOn && (fromDbDate(grant.endsOn) ?? '') < today;
}

/**
 * Closes the open grants that are past their end date, each with an audit entry. Safe to run at
 * the same time from two requests: only the one that actually closes a grant records it.
 */
export async function closeEndedGrants(where: Prisma.AccessGrantWhereInput = {}) {
  const today = todayManila();
  const due = await prisma.accessGrant.findMany({
    where: { ...where, removedAt: null, endsOn: { lt: toDbDate(today) } },
  });
  for (const grant of due) {
    await prisma.$transaction(async (tx) => {
      const closed = await tx.accessGrant.updateMany({
        where: { id: grant.id, removedAt: null },
        data: { removedAt: new Date(), removeReason: 'Reached its end date' },
      });
      if (closed.count === 1) {
        await audit(tx, null, 'user.access-expire', 'user', grant.userId, grantAudit(grant), {
          ...grantAudit(grant),
          removeReason: 'Reached its end date',
        });
      }
    });
  }
}

/** Everything this user can do now: their role's work plus any open extra access. */
export async function workOf(user: User): Promise<Set<Work>> {
  const work = new Set<Work>(ROLE_WORK[user.role]);
  if (user.role === 'ADMIN' || user.role === 'BOARD') return work;
  const open = await prisma.accessGrant.findMany({ where: { userId: user.id, removedAt: null } });
  const today = todayManila();
  if (open.some((g) => isPastEnd(g, today))) await closeEndedGrants({ userId: user.id });
  for (const g of open) if (!isPastEnd(g, today) && g.work in WORK) work.add(g.work as Work);
  return work;
}

/** What goes into the audit log for a grant (plain fields only). */
export function grantAudit(g: AccessGrant) {
  return {
    work: g.work,
    workLabel: WORK[g.work as Work] ?? g.work,
    requestedBy: g.requestedBy,
    reason: g.reason,
    endsOn: fromDbDate(g.endsOn),
  };
}

export function grantJson(g: GrantWithPeople) {
  return {
    id: g.id,
    work: g.work,
    label: WORK[g.work as Work] ?? g.work,
    requestedBy: g.requestedBy,
    reason: g.reason,
    endsOn: fromDbDate(g.endsOn),
    grantedAt: g.grantedAt.toISOString(),
    grantedBy: g.grantedBy.name,
    removedAt: g.removedAt?.toISOString() ?? null,
    removedBy: g.removedBy?.name ?? null,
    removeReason: g.removeReason,
  };
}

export const grantPeople = { grantedBy: { select: { name: true } }, removedBy: { select: { name: true } } } as const;
