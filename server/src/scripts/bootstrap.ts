/*
 * Safe to run on every deploy, including production. It only fills in what is missing:
 *   - the 8 areas (if there are no areas yet)
 *   - default settings and IWMPC's approved water tariff (if there are no rates yet)
 *   - the first Admin user (if there are no users yet and ADMIN_EMAIL / ADMIN_PASSWORD are set)
 * It never adds sample data. See seed.ts for that.
 */
import '../lib/useDirectUrl';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { ensureDefaultRates } from '../services/rates';
import { ensureDefaultSettings } from '../services/settings';

export const DEFAULT_AREAS = ['Almasiga', 'Ipil', 'Guijo', 'Narra', 'Narra Extension', 'Yakal', 'Mulawin', 'Kamagong'];

export async function bootstrap() {
  if ((await prisma.area.count()) === 0) {
    await prisma.area.createMany({ data: DEFAULT_AREAS.map((name) => ({ name })) });
    console.log('Added the default areas.');
  }
  await ensureDefaultSettings(prisma);
  await ensureDefaultRates(prisma);

  if ((await prisma.user.count()) === 0) {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (email && password && password.length >= 8) {
      await prisma.user.create({
        data: { name: 'Administrator', email, role: 'ADMIN', passwordHash: await bcrypt.hash(password, 10) },
      });
      console.log(`Created the first Admin user: ${email}`);
    } else {
      console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) to create the first Admin.');
    }
  }
}

if (require.main === module) {
  bootstrap()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
