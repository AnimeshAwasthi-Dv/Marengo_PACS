import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { modalityServices } from '../server/uploadPipeline';

const prisma = new PrismaClient();
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const userId = process.env.ADMIN_USER_ID?.trim() || 'admin';
  if (!email || !password || password.length < 12) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) before seeding.');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) await prisma.user.create({ data: { email, userId, name: 'Portal Administrator', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 12), lastGeneratedPassword: null } });
  else if (existing.role !== 'SUPER_ADMIN') throw new Error('ADMIN_EMAIL belongs to a non-administrator account.');
  for (const service of modalityServices) await prisma.service.upsert({
    where: { name: service.name }, update: {},
    create: { name: service.name, code: service.code, category: 'PACS', description: 'PACS intake, reporting and configured report return.', enabled: true },
  });
  console.log('Administrator and service catalog ready. Existing accounts/passwords are unchanged. Configure centers and tariffs in the portal.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
