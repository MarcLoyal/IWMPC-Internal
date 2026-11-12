// Import this before ../lib/prisma in one-off scripts (bootstrap, seed).
// They run at build time, where the direct connection is the right one to use.
import 'dotenv/config';

if (process.env.DIRECT_URL) process.env.DATABASE_URL = process.env.DIRECT_URL;
