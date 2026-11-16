import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { ConnectionStatus, Role } from '@prisma/client';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { ensureDefaultRates } from '../services/rates';
import { ensureDefaultSettings } from '../services/settings';

const PASSWORD = 'password123';
// Low cost so tests stay fast.
const HASH = bcrypt.hashSync(PASSWORD, 4);

/** Empties the test database and adds the basics: one area, settings, one user per role. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_log, payments, sale_items, sales, price_changes, product_units, products, water_bills, meter_readings, rate_schedules, beneficiaries, water_connections, accounts, areas, settings, users RESTART IDENTITY CASCADE',
  );
  await prisma.area.createMany({ data: [{ name: 'Narra' }, { name: 'Ipil' }] });
  await ensureDefaultSettings(prisma);
  await ensureDefaultRates(prisma);
  await prisma.setting.update({ where: { key: 'membership_fee' }, data: { value: '500.00' } });
  await prisma.setting.update({ where: { key: 'installation_fee' }, data: { value: '3500.00' } });
  for (const role of ['ADMIN', 'CASHIER', 'STAFF', 'BOARD'] as Role[]) {
    await prisma.user.create({
      data: { name: role, email: `${role.toLowerCase()}@test.local`, role, passwordHash: HASH },
    });
  }
}

/** A logged-in session for the given role. */
export async function loginAs(role: Role) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: `${role.toLowerCase()}@test.local`, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${role}: ${res.status}`);
  return agent;
}

let meter = 0;

/** Creates an account directly, optionally with one connection in the given status. */
export async function makeAccount(fullName: string, connection?: ConnectionStatus) {
  const count = await prisma.account.count();
  const account = await prisma.account.create({
    data: { fullName, ...nameParts(fullName), areaId: 1, accountNumber: `T-${String(count + 1).padStart(4, '0')}` },
  });
  if (connection) {
    await prisma.waterConnection.create({
      data: { accountId: account.id, connectionNumber: `TM-${++meter}`, status: connection },
    });
  }
  return account;
}

function nameParts(fullName: string) {
  const words = fullName.trim().split(/\s+/);
  const lastName = words.length > 1 ? words.pop()! : words[0];
  return { firstName: words.length ? words.join(' ') : lastName, lastName };
}

/** A filled-in Application for Membership, as the Make a Member screen sends it. */
export function membershipForm(fullName: string, extra: Record<string, unknown> = {}) {
  return {
    ...nameParts(fullName),
    areaId: 1,
    birthDate: '1960-01-15',
    sex: 'MALE',
    civilStatus: 'MARRIED',
    ...extra,
  };
}
