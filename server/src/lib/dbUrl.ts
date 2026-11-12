/**
 * Supabase's "Transaction pooler" (port 6543) does not support prepared statements.
 * Prisma must be told with ?pgbouncer=true, otherwise queries fail with
 * `prepared statement "s0" already exists`. This adds the flag when it was left out.
 */
export function runtimeDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const pooled = url.port === '6543' || url.hostname.includes('pooler.supabase.com') && url.port !== '5432';
    if (pooled && !url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
      return url.toString();
    }
  } catch {
    /* not a parsable URL: let Prisma report it */
  }
  return raw;
}
