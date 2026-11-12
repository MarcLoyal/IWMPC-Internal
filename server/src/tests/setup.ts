import { execSync } from 'node:child_process';
import path from 'node:path';

// Tests always use their own database, never the dev or preview one.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/iwmpc_test';
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.JWT_SECRET = 'test-secret';

const g = globalThis as unknown as { __iwmpcMigrated?: boolean };
if (!g.__iwmpcMigrated && !process.env.IWMPC_TEST_MIGRATED) {
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../..'), env: process.env, stdio: 'pipe' });
  process.env.IWMPC_TEST_MIGRATED = '1';
  g.__iwmpcMigrated = true;
}
