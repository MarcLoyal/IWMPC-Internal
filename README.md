# IWMPC Internal System

Internal system for the Inicbulan Waterworks Multi-purpose Cooperative: accounts, cashier
collections recorded with the OR number from IWMPC's own receipt booklet, and (in later phases)
water billing and loans.

**Current phase: 1A** — Accounts, Cashier, Home, Settings, Users.

| Phase | Contents | Status |
|---|---|---|
| 1A | Accounts (member / non-member), basic connections, Cashier with OR numbers, Daily Collection Report, Home, Settings, Users | Built |
| 1B | Water: meter readings, billing, overdue list | Not started |
| 1C | Loans | Not started |

## What is in 1A

- **Accounts**: search by name / account no. / member no., Type and Area dropdowns with counts, profile
  with Personal Info, Water (connections) and All Transactions tabs, Print.
- **Connections**: add a connection, Pending Installation → Active → Disconnected. Needed in 1A because
  Make a Member requires an active connection. Readings and bills come in 1B.
- **Paper forms**: the account, Make a Member and Add Connection screens follow IWMPC's Application for
  Membership and water connection application (Form No. 2-A) field for field.
- **Make a Member**: staff click *Make a Member* (blocked without an active connection, checked on the
  server), the cashier records the membership fee in full, and the account becomes a Member with the
  next member number. Voiding that payment returns the account to Non-member; the number stays reserved.
- **Cashier**: pick account → see what they owe → payment type (Installation Fee, Membership Fee,
  Share Capital, Other) → amount → OR number → "Is this correct?" → save. Duplicate OR numbers are blocked with a
  message saying who and when. Find a payment by OR number. Void is Admin only, with a reason.
- **Daily Collection Report**: every payment of the day with OR numbers, totals per type, grand total,
  missing OR numbers flagged. Printable.
- **Settings** (Admin): cooperative info, fees, account / member number format, areas, users and roles.
- **Audit trail**: every change is stored in `audit_log` with who, what, when, before and after.

## Tech

React + TypeScript + Vite + Tailwind (`client/`), Node + Express + TypeScript (`server/`),
PostgreSQL via Prisma, hosted on Vercel (`api/index.ts` wraps the Express app as one function).
Login is email + password (bcrypt) with a signed, http-only cookie.

```
client/   screens (src/pages), shared UI (src/components), helpers (src/lib)
server/   prisma/ (schema, migrations)   src/routes   src/services   src/tests   src/scripts
api/      Vercel entry point
```

## Run it on your computer

Needs Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example server/.env      # then edit server/.env
npm run db:migrate               # creates the tables
npm run db:seed                  # sample data (only when SEED_SAMPLE_DATA="true")
npm run dev                      # http://localhost:5173
```

Sample logins (sample data only), password `iwmpc12345`:

| Role | Email |
|---|---|
| Admin | admin@iwmpc.test |
| Cashier | cashier@iwmpc.test |
| Staff / Encoder | staff@iwmpc.test |
| Board (view only) | board@iwmpc.test |

If `ADMIN_EMAIL` is set to `admin@iwmpc.test`, that user is created first with `ADMIN_PASSWORD` instead.

## Tests

```bash
npm test
```

Uses its own database (`TEST_DATABASE_URL`, default `iwmpc_test` on localhost), never the dev or
preview database. Covers duplicate-OR blocking, voiding, the Make a Member rule, roles, search and
filters, OR-gap detection and money formatting.

## Deploying to Vercel + Supabase

1. Create a Supabase project for IWMPC (separate from other projects).
2. Import this repo into Vercel as one project (root directory = repo root; `vercel.json` does the rest).
3. Set these environment variables in Vercel:

| Variable | Value | Environments |
|---|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** URL (port 6543) with `?pgbouncer=true` | Preview, Production |
| `DIRECT_URL` | Supabase **Session pooler** URL (port 5432), used for migrations | Preview, Production |
| `JWT_SECRET` | long random text (`openssl rand -hex 32`) | Preview, Production |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first Admin login, created once when there are no users | Preview, Production |
| `SEED_SAMPLE_DATA` | `true` | **Preview only** |

Every deploy runs the migrations, then fills in anything missing (areas, default settings, first
Admin). Sample data is added only when **all** of these are true: `SEED_SAMPLE_DATA=true`, the deploy
is a Vercel *Preview*, and the database has no accounts yet. It is never added on a Production deploy.

Preview and Production must use **different databases** (different Supabase projects) so sample data
can never reach real records.
