import { PrismaClient, Prisma } from '@prisma/client';
import { runtimeDatabaseUrl } from './dbUrl';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: runtimeDatabaseUrl(process.env.DATABASE_URL) });
globalForPrisma.prisma = prisma;

/** A Prisma client or an open transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
