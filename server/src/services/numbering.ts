import { Prisma } from '@prisma/client';
import { getSettings } from './settings';

type Kind = 'account' | 'member' | 'loan';

export function formatNumber(prefix: string, padding: number, n: number): string {
  return prefix + String(n).padStart(padding, '0');
}

/**
 * Hands out the next account or member number. Must run inside a transaction: the counter
 * row is locked so two people saving at the same moment can't get the same number.
 * Numbers already in use (e.g. existing member numbers encoded at setup) are skipped.
 */
export async function nextNumber(tx: Prisma.TransactionClient, kind: Kind): Promise<string> {
  const counterKey = `${kind}_no_next`;
  await tx.$queryRaw`SELECT key FROM settings WHERE key = ${counterKey} FOR UPDATE`;
  const settings = await getSettings(tx);
  const prefix = settings[`${kind}_no_prefix`];
  const padding = Math.max(1, parseInt(settings[`${kind}_no_padding`], 10) || 1);
  let n = Math.max(1, parseInt(settings[`${kind}_no_next`], 10) || 1);

  for (;;) {
    const candidate = formatNumber(prefix, padding, n);
    const taken =
      kind === 'account'
        ? await tx.account.findUnique({ where: { accountNumber: candidate }, select: { id: true } })
        : kind === 'loan'
          ? await tx.loan.findUnique({ where: { number: candidate }, select: { id: true } })
          : await tx.account.findUnique({ where: { memberNumber: candidate }, select: { id: true } });
    n += 1;
    if (!taken) {
      await tx.setting.upsert({
        where: { key: counterKey },
        update: { value: String(n) },
        create: { key: counterKey, value: String(n) },
      });
      return candidate;
    }
  }
}
