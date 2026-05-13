import { PrismaClient } from '@prisma/client';

export function createTestPrisma(): PrismaClient {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL not set — globalSetup did not run');
  return new PrismaClient({ datasources: { db: { url } } });
}

export async function cleanTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE
    portal_accounts,
    notification_preferences,
    statements,
    transactions,
    payment_due_schedules,
    accounts,
    applications
    RESTART IDENTITY CASCADE`);
}
