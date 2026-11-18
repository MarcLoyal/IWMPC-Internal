import { PrismaClient, Prisma } from '@prisma/client';
import { runtimeDatabaseUrl } from './dbUrl';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: runtimeDatabaseUrl(process.env.DATABASE_URL) });
globalForPrisma.prisma = prisma;

/**
 * Options for transactions that do many small steps (an invoice with several items, a loan payment).
 * Prisma's default limit is 5 seconds, which Supabase over the network can pass on a busy day:
 * wait up to 10 seconds to start, and allow 20 seconds to finish.
 */
export const LONG_TX = { maxWait: 10_000, timeout: 20_000 } as const;

/** A Prisma client or an open transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
