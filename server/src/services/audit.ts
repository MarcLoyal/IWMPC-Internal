import { Prisma } from '@prisma/client';
import type { Db } from '../lib/prisma';

/** Records who did what and when. `before`/`after` hold the changed record. */
export async function audit(
  db: Db,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  before?: unknown,
  after?: unknown,
) {
  const json = (v: unknown) =>
    v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);
  await db.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId: entityId === null ? null : String(entityId),
      before: json(before),
      after: json(after),
    },
  });
}
