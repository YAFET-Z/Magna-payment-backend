import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
  console.log('Creating master manager account...');
  await prisma.user.create({
    data: {
      email: 'admin@magnapay.com',
      password: 'magnaadmin123',
      fullName: 'System Admin',
      role: 'MANAGER',
      requiresSetup: false,
      dailyWage: 0
    }
  });
  console.log('✅ Admin account created. You can now log into the app.');
}

seed()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());