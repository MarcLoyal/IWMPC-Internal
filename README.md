# IWMPC Internal System

Internal system for the Inicbulan Waterworks Multi-purpose Cooperative: accounts, cashier
collections recorded with the Invoice No. from IWMPC's own BIR Service Invoice booklet, and (in later phases)
water billing and loans.

**Current phase: 1A + 1B + 2** — Accounts, Cashier, Home, Settings, Users, Water, and Rice & LPG sales.

| Phase | Contents | Status |
|---|---|---|
| 1A | Accounts (member / non-member), basic connections, Cashier with Invoice Nos., Daily Collection Report, Home, Settings, Users | Built |
| 1B | Water: rates, meter readings, bills, customer card, overdue list | Built |
| 1C | Loans | Not started |
| 2 | Rice & LPG sales at the Cashier, admin-only prices with history | Built |

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
- **Cashier**: pick account → see what they owe → add each thing being paid to one invoice → Invoice No.
  → *Review Payment* (the invoice guide pops up) → save. See *BIR Service Invoices* below. Duplicate
  numbers are blocked with a message saying who and when. Find a payment by Invoice No. Void is Admin
  only, with a reason.
- **Daily Collection Report**: every payment of the day with Invoice Nos., totals per type, grand total,
  missing numbers flagged. Printable.
- **Settings** (Admin): cooperative info, fees, account / member number format, areas, users and roles.
- **Audit trail**: every change is stored in `audit_log` with who, what, when, before and after.

## What is in 1B (Water)

- **Meter reading**: pick the month and area, type each current reading; cu.m and amount show as you
  type. Warnings (never blocks) for a reading lower than the last one or more than 3x the usual use.
  *Save and Create Bills* makes the bills. The same screen prints as a reading sheet.
- **Customer Card** on each account's Water tab, laid out like IWMPC's paper card: month, date read,
  reading, cu.m, amount (and late penalty), O.R. No., date paid. Year selector, printable.
- **Bills**: Paid (green) / Due soon, within 5 days (yellow) / Overdue (red). The late penalty is added
  when the bill amount is not fully paid on or before the due date. Printable bill / notice with the
  previous balance.
- **Cashier**: Water Bill payment type, pre-filled with what is owed; part payments allowed; the Invoice
  number lands on the customer card.
- **Lists**: overdue accounts by area (printable) and disconnection candidates (view only).
- **Rates** (Admin): IWMPC's approved tariff is loaded at setup. *Change Rates* adds a new version that
  starts in a chosen month.

### Rates and past bills

A bill stores its own amount, penalty and due date at the moment it is created, and points at the
rate version it used. Changing rates, the penalty or the due-date days only affects bills created
afterwards. New rates cannot start in a month that already has bills.

### How a bill is computed

Checked against IWMPC's customer cards: the minimum charge covers the first cu.m (5 for residential),
and **every** cu.m above that is charged at the price of the block the total falls in.
22 cu.m residential = 89.00 + (22 - 5) x 24.80 = 510.60. The other common method (each block at its
own price) is available as an option when changing rates.

## What is in Phase 2 (Rice & LPG)

- **Products and prices** (Settings → Rice & LPG Prices): products such as Dinorado, Sinandomeng and LPG, each marked as Rice, LPG or Other,
  each with one or more units (per sack (25 kg), per 11 kg tank) and a price. An optional member
  price applies to members only. New products and units are added on screen, with no code change.
- **Prices are Admin only.** Every route that changes a product, a price, a water rate or a setting
  checks the Admin role on the server. Everyone else can see prices but not change them. Each price
  change needs a reason and is kept in the product's Price History (old and new price, who, when, why).
- **Selling at the Cashier**: payment type *Rice & LPG* → pick the product (big buttons) → pick the unit →
  quantity (decimals allowed) → the amount is worked out → add more items if needed → added to the
  invoice like any other payment, so one invoice can hold water, fees and rice/LPG together.
- **Walk-in customer**: a buyer with no account (name optional). Counted in the day's collections and
  reports, but on no account.
- **Past sales never change.** Each item keeps the product name, unit, quantity and price it was sold at.
- **Voiding** the payment voids the whole sale; it stays visible, marked VOID, and leaves all totals.
- **Credit (utang)**: Settings → *Allow credit*, OFF by default (the server refuses credit sales while it
  is off). When ON, a credit sale is written on its own CHARGE SALES invoice (number taken at the time of
  sale), appears in *What they owe*, and is paid later on a new cash invoice. Walk-ins cannot buy on credit.
- **On the account**: last Rice/LPG purchase on the Accounts list, a Rice & LPG card (bought this year),
  a printable Rice & LPG tab with yearly totals per item, and the sales in All Transactions.
- **Reports**: Rice & LPG lines on the Daily Collection Report, and a printable *Rice & LPG Sales* report
  by date range and product.
- **Not yet**: stock / inventory, and patronage refund. Purchases stay linked to accounts for the refund.

## Printing water bills

*Meter Readings → Print Bills* prints IWMPC's **WATER SERVICE BILLING** form, 4 bills on each sheet
(2 × 2) with dotted cut lines, on Short bond (Letter) or Long bond (8.5 × 13).

- Choose the billing month, areas, *All bills* or *Unpaid only*, and the order (area then name, or
  meter number). A summary shows the number of bills and pages per area, and lists active
  connections with no reading for that month. Optionally one PDF per area.
- Each bill shows this month, unpaid earlier months (with penalty), any part payment, and the
  **TOTAL AMOUNT DUE**, worked out on the server so it matches the account exactly. More than 5
  unpaid earlier months are combined into one row.
- The header, phone line, due day and the three signatories come from Settings → *Printed Water Bills*.
- Every print is recorded (who and when); reprints are always allowed and look the same.
- A single bill prints from the account's customer card (*Print bill*) or the bill pop-up.
- **How large batches work:** the server sends the figures 500 bills at a time and the PDF is made in
  the browser, so Vercel's time and size limits never apply. About 1,200 bills take ~5 seconds and
  make a ~1.5 MB PDF. The PDF code (with an embedded font that has the ₱ sign) loads only when printing.
- **Due date rule** (Settings → Water Billing): new bills are due on a set day of the month after the
  billing month (default 15), or a number of days after the reading. Existing bills keep their date.

## Signatures and the 2-month notice

- **Signatures** (Settings → Signatures on Printed Bills, Admin only): upload a PNG for each signatory of
  the monthly bill and of the notice. A white background is removed and the edges trimmed on the
  server. Images are stored in a **private Supabase Storage bucket** (`signatures`, created on first use)
  and read only by the server with the service key; when Supabase is not configured (local, tests)
  they are kept in the `signature_images` table. They reach a browser only inside the print data, to
  be drawn into the PDF. There is no public link; only Admins see a small preview. Each signatory has
  a *Print signature* switch; with it off (or no image) the name prints with a blank line. Every
  upload, replacement, removal and switch is in the audit log.
- **Who can print bills:** Admin, Staff and Cashier (checked on the server). Board can view bills but
  not print them, so never receives signatures. Note: anyone who can print can save the PDF.
- **2-month unpaid notice:** accounts with 2 or more months owed (counting the month being billed;
  Settings → *Printed 2-Month Notice*) get the notice instead of the monthly bill: MONTH / CONSUMPTION /
  AMOUNT w/o PENALTY / PENALTY / TOTAL AMOUNT per unpaid month and a TOTAL row, the due date (no
  penalty), the disconnection date (due date + days from Settings, or one date for the whole batch),
  the reconnection fee note, and its own signatories and phone line. 1 per landscape page or 2 per page.
  Print Bills has *Which form*: monthly bills, notices, or both (two PDFs).
- **Money settings** (penalty, reconnection fee) need a reason; every change is kept in
  `setting_changes` and shown under *History of changes*. New values apply to bills made afterwards.
- **Vercel variables for signature storage:** `SUPABASE_URL` and either `SUPABASE_SECRET_KEY` (the new
  `sb_secret_...` key, recommended) or `SUPABASE_SERVICE_ROLE_KEY` (the legacy JWT key), from Supabase →
  Project Settings → API Keys. Server-side only; never in a `VITE_` variable. Without them signatures are
  kept in the database.

## BIR Service Invoices

IWMPC writes **handwritten** BIR Service Invoices from bound booklets (manual ATP). The system never
prints an invoice; it shows a **guide** to copy from.

- **One invoice per visit.** The cashier adds everything being paid (several water months, fees, share
  capital, rice & LPG, other) and types the **Invoice No.** from the booklet. It is required and can be
  used once only (checked on the server, also against old payment numbers). It is filled in with the
  cashier's last number + 1. A number outside the ATP series (Settings → *Invoice Booklet*, default
  25,001–40,000) gives a yellow warning but is allowed.
- **Review Payment** opens the guide in a pop-up on the same page, nothing saved yet: *Go Back* or
  *Yes, Save Payment*. After saving, the same pop-up shows *Saved* so the cashier can finish copying.
- **The guide** mirrors the paper form: Registered Name (or the walk-in's name / "Walk-in customer"),
  TIN, address, meter no., period, lines A–D, amount in words, total. It has a diagonal *Guide only –
  not an invoice* watermark and no print or download button; printing shows only "This guide cannot be
  printed. Use the BIR Service Invoice booklet."
- **Where to see it again:** Payment Details → *View Invoice Guide*, Find by Invoice No., and *Open bill*
  on the customer card (tabs *Invoice* and *Billing*: a paid bill opens on its invoice; an unpaid bill
  shows the billing only).
- **Cancelling:** an Admin voiding any payment on an invoice cancels the whole invoice (all its
  payments, with a reason). The number is marked CANCELLED and never reused.
- **Home** warns the Admin and Cashier when fewer than 2,000 numbers are left in the series.
- "OR number" is now called **Invoice No.** everywhere on screen, including old payments.

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
preview database. Covers duplicate Invoice No. blocking, the invoice guide values, voiding, the Make a Member rule, roles, search and
filters, invoice-number gap detection and money formatting.

## Deploying to Vercel + Supabase

**Region:** `vercel.json` runs the API in Vercel's Tokyo region (`hnd1`), next to the Supabase
database (Northeast Asia, Tokyo). Keep them in the same region: every screen makes several database
trips, and a server far from the database makes each one cost about a quarter of a second.

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
