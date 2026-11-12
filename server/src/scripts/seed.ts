/*
 * SAMPLE DATA for previews and local development only. NEVER for production.
 *
 * Guards:
 *   - does nothing unless SEED_SAMPLE_DATA=true
 *   - refuses to run on a Vercel production deploy
 *   - with --preview-only (used by the Vercel build) it runs only on Vercel Preview deploys
 *   - does nothing if the database already has accounts
 */
import '../lib/useDirectUrl';
import bcrypt from 'bcryptjs';
import type { ConnectionStatus, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toDbDate, todayManila } from '../lib/dates';
import { parseMoney } from '../lib/money';
import { recordPayment } from '../services/payments';
import { startMembership } from '../services/membership';
import { nextNumber } from '../services/numbering';
import { bootstrap } from './bootstrap';

const SAMPLE_PASSWORD = 'iwmpc12345';

const USERS: { name: string; email: string; role: Role }[] = [
  { name: 'Marc (Admin)', email: 'admin@iwmpc.test', role: 'ADMIN' },
  { name: 'Lorna Mendoza', email: 'cashier@iwmpc.test', role: 'CASHIER' },
  { name: 'Rodel Aquino', email: 'staff@iwmpc.test', role: 'STAFF' },
  { name: 'Atty. Ben Salazar', email: 'board@iwmpc.test', role: 'BOARD' },
];

interface Person {
  name: string;
  area: string;
  street: string;
  phone: string;
  birth: string;
  civil: 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'SEPARATED';
  connection?: ConnectionStatus;
  /** member = fully paid member; pending = clicked Make a Member, fee not yet paid */
  membership?: 'member' | 'pending';
  beneficiary?: [string, string];
}

const PEOPLE: Person[] = [
  { name: 'Juan Dela Cruz', area: 'Narra', street: '12 Narra St.', phone: '0917 555 0101', birth: '1958-03-14', civil: 'MARRIED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Maria Dela Cruz', 'Spouse'] },
  { name: 'Maria Clara Santos', area: 'Almasiga', street: '5 Almasiga St.', phone: '0918 555 0102', birth: '1965-07-02', civil: 'WIDOWED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Jose Santos', 'Son'] },
  { name: 'Jose Rizal Reyes', area: 'Ipil', street: '27 Ipil St.', phone: '0919 555 0103', birth: '1972-12-30', civil: 'MARRIED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Lourdes Reyes', 'Spouse'] },
  { name: 'Lourdes Garcia', area: 'Guijo', street: '8 Guijo St.', phone: '0920 555 0104', birth: '1960-02-11', civil: 'MARRIED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Pedro Garcia', 'Spouse'] },
  { name: 'Pedro Bautista', area: 'Yakal', street: '41 Yakal St.', phone: '0921 555 0105', birth: '1955-09-21', civil: 'SEPARATED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Ana Bautista', 'Daughter'] },
  { name: 'Rosalinda Villanueva', area: 'Narra Extension', street: '3 Narra Ext.', phone: '0922 555 0106', birth: '1968-05-05', civil: 'MARRIED', connection: 'DISCONNECTED', membership: 'member', beneficiary: ['Ramon Villanueva', 'Spouse'] },
  { name: 'Emilio Aguinaldo Ramos', area: 'Mulawin', street: '19 Mulawin St.', phone: '0923 555 0107', birth: '1975-03-22', civil: 'MARRIED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Hilaria Ramos', 'Spouse'] },
  { name: 'Corazon Mercado', area: 'Kamagong', street: '2 Kamagong St.', phone: '0924 555 0108', birth: '1962-01-25', civil: 'WIDOWED', connection: 'ACTIVE', membership: 'member', beneficiary: ['Benigno Mercado', 'Son'] },
  { name: 'Andres Bonifacio Cruz', area: 'Narra', street: '30 Narra St.', phone: '0925 555 0109', birth: '1980-11-30', civil: 'SINGLE', connection: 'ACTIVE', membership: 'pending', beneficiary: ['Catalina Cruz', 'Mother'] },
  { name: 'Teresita Flores', area: 'Almasiga', street: '14 Almasiga St.', phone: '0926 555 0110', birth: '1970-10-15', civil: 'MARRIED', connection: 'ACTIVE' },
  { name: 'Ramon Magsaysay Torres', area: 'Ipil', street: '9 Ipil St.', phone: '0927 555 0111', birth: '1978-08-31', civil: 'MARRIED', connection: 'ACTIVE' },
  { name: 'Gloria Pascual', area: 'Guijo', street: '22 Guijo St.', phone: '0928 555 0112', birth: '1985-04-05', civil: 'SINGLE', connection: 'ACTIVE' },
  { name: 'Ferdinand Castillo', area: 'Yakal', street: '6 Yakal St.', phone: '0929 555 0113', birth: '1990-09-11', civil: 'SINGLE', connection: 'PENDING_INSTALLATION' },
  { name: 'Imelda Navarro', area: 'Mulawin', street: '33 Mulawin St.', phone: '0930 555 0114', birth: '1982-07-02', civil: 'MARRIED', connection: 'PENDING_INSTALLATION' },
  { name: 'Manuel Quezon Domingo', area: 'Kamagong', street: '17 Kamagong St.', phone: '0931 555 0115', birth: '1988-08-19', civil: 'MARRIED', connection: 'DISCONNECTED' },
  { name: 'Josefa Llanes Escoda', area: 'Narra Extension', street: '11 Narra Ext.', phone: '0932 555 0116', birth: '1995-09-20', civil: 'SINGLE' },
];

const FEMALE = new Set(['Maria Clara Santos', 'Lourdes Garcia', 'Rosalinda Villanueva', 'Corazon Mercado', 'Teresita Flores', 'Gloria Pascual', 'Imelda Navarro', 'Josefa Llanes Escoda']);
const TWO_WORD_SURNAMES = ['Dela Cruz'];

/** "Juan Dela Cruz" -> given name "Juan", family name "Dela Cruz". */
function nameParts(name: string) {
  const surname = TWO_WORD_SURNAMES.find((s) => name.endsWith(` ${s}`)) ?? name.split(' ').pop()!;
  return { firstName: name.slice(0, -surname.length).trim(), middleName: '', lastName: surname };
}

function daysAgo(n: number): string {
  return todayManila(new Date(Date.now() - n * 86_400_000));
}

async function seed() {
  if (process.env.SEED_SAMPLE_DATA !== 'true') {
    console.log('Sample data skipped (SEED_SAMPLE_DATA is not "true").');
    return;
  }
  if (process.env.VERCEL_ENV === 'production') {
    console.log('Sample data skipped: this is a production deploy.');
    return;
  }
  if (process.argv.includes('--preview-only') && process.env.VERCEL_ENV !== 'preview') {
    console.log('Sample data skipped: not a Vercel Preview deploy.');
    return;
  }
  if ((await prisma.account.count()) > 0) {
    console.log('Sample data skipped: the database already has accounts.');
    return;
  }

  await bootstrap();
  await prisma.setting.update({ where: { key: 'membership_fee' }, data: { value: '500.00' } });
  await prisma.setting.update({ where: { key: 'installation_fee' }, data: { value: '3500.00' } });
  await prisma.setting.update({ where: { key: 'coop_address' }, data: { value: 'Inicbulan, Bauan, Batangas' } });

  const passwordHash = await bcrypt.hash(SAMPLE_PASSWORD, 10);
  for (const u of USERS) {
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } });
  }
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@iwmpc.test' } });
  const staff = await prisma.user.findUniqueOrThrow({ where: { email: 'staff@iwmpc.test' } });
  const areas = new Map((await prisma.area.findMany()).map((a) => [a.name, a.id]));

  let or = 1001;
  const pay = async (accountId: number, type: 'INSTALLATION_FEE' | 'MEMBERSHIP_FEE' | 'SHARE_CAPITAL' | 'OTHER', amount: string, date: string, description = '') => {
    const payment = await recordPayment(
      { accountId, type, amount: parseMoney(amount)!, orNumber: String(or++), description },
      cashier.id,
    );
    // Spread the sample payments over past days so reports have some history.
    await prisma.payment.update({ where: { id: payment.id }, data: { paymentDate: toDbDate(date) } });
    return payment;
  };

  let meter = 1;
  const created: { id: number; person: Person }[] = [];
  for (const person of PEOPLE) {
    const account = await prisma.$transaction(async (tx) =>
      tx.account.create({
        data: {
          accountNumber: await nextNumber(tx, 'account'),
          fullName: person.name,
          ...nameParts(person.name),
          purok: person.street,
          barangay: 'Inicbulan',
          municipality: 'Bauan',
          province: 'Batangas',
          address: `${person.street}, Inicbulan, Bauan, Batangas`,
          sex: FEMALE.has(person.name) ? 'FEMALE' : 'MALE',
          religion: 'Roman Catholic',
          areaId: areas.get(person.area)!,
          phone: person.phone,
          birthDate: toDbDate(person.birth),
          civilStatus: person.civil,
          idType: "Voter's ID",
          idNumber: `4102-${String(1000 + meter)}`,
          createdById: staff.id,
        },
      }),
    );
    created.push({ id: account.id, person });

    if (person.connection) {
      await prisma.waterConnection.create({
        data: {
          accountId: account.id,
          connectionNumber: `WM-${String(meter).padStart(4, '0')}`,
          address: `${person.street}, Inicbulan, Bauan, Batangas`,
          applicationDate: toDbDate(daysAgo(person.connection === 'PENDING_INSTALLATION' ? 5 : 410 + meter * 7)),
          meterName: person.name,
          meterSerial: `SN-${String(520100 + meter * 37)}`,
          // Members must be active when they join; a later disconnection is applied below.
          status: person.connection === 'PENDING_INSTALLATION' ? 'PENDING_INSTALLATION' : 'ACTIVE',
          installationDate: person.connection === 'PENDING_INSTALLATION' ? null : toDbDate(daysAgo(400 + meter * 7)),
        },
      });
    }
    meter++;
  }

  // Memberships, through the same Make a Member flow the staff use.
  let day = 40;
  for (const { id, person } of created) {
    if (!person.membership) continue;
    const beneficiaries = person.beneficiary ? [{ name: person.beneficiary[0], relationship: person.beneficiary[1] }] : [];
    const applied = daysAgo(person.membership === 'member' ? day + 3 : 2);
    await prisma.$transaction((tx) =>
      startMembership(tx, id, beneficiaries, staff.id, {
        membershipAppliedOn: toDbDate(applied),
        membershipPurpose: 'To avail of the services of the cooperative',
        sharesSubscribed: 10,
        sharesAmount: parseMoney('1000.00'),
        meterRegisteredName: person.name,
        pmesAttended: true,
        boardDecision: person.membership === 'member' ? 'APPROVED' : null,
        boardDecisionDate: person.membership === 'member' ? toDbDate(applied) : null,
      }),
    );
    if (person.membership === 'member') {
      const date = daysAgo(day);
      await pay(id, 'MEMBERSHIP_FEE', '500.00', date);
      await prisma.account.update({ where: { id }, data: { memberSince: toDbDate(date) } });
      day -= 4;
    }
  }
  for (const { id, person } of created) {
    if (person.connection === 'DISCONNECTED') {
      await prisma.waterConnection.updateMany({ where: { accountId: id }, data: { status: 'DISCONNECTED' } });
    }
  }

  // A few recent payments, including today's, a skipped OR number, and one voided payment.
  const byName = (name: string) => created.find((c) => c.person.name === name)!.id;
  await pay(byName('Imelda Navarro'), 'INSTALLATION_FEE', '3500.00', daysAgo(3));
  await pay(byName('Teresita Flores'), 'OTHER', '150.00', daysAgo(1), 'Certification fee');
  await pay(byName('Maria Clara Santos'), 'SHARE_CAPITAL', '1000.00', daysAgo(1));
  await pay(byName('Juan Dela Cruz'), 'OTHER', '50.00', daysAgo(0), 'Photocopy of records');
  const mistake = await pay(byName('Gloria Pascual'), 'OTHER', '1000.00', daysAgo(0), 'Meter relocation');
  or++; // OR skipped on purpose so the Daily Collection Report shows a gap
  await pay(byName('Ramon Magsaysay Torres'), 'OTHER', '100.00', daysAgo(0), 'Certification fee');
  const { voidPayment } = await import('../services/payments');
  await voidPayment(mistake.id, 'Wrong amount written on the receipt', admin.id);

  console.log(`Sample data added: ${PEOPLE.length} accounts. Sample logins use the password "${SAMPLE_PASSWORD}".`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
