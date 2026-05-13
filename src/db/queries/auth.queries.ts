import { PrismaClient } from '@prisma/client';

export async function createPortalAccount(
  prisma: PrismaClient,
  accountId: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  await prisma.portalAccount.create({ data: { accountId, email, passwordHash } });
}

export async function getPortalAccountByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<{ accountId: string; passwordHash: string } | null> {
  const row = await prisma.portalAccount.findUnique({ where: { email } });
  return row ? { accountId: row.accountId, passwordHash: row.passwordHash } : null;
}

export async function portalAccountExistsForAccountId(
  prisma: PrismaClient,
  accountId: string,
): Promise<boolean> {
  const row = await prisma.portalAccount.findUnique({ where: { accountId } });
  return row !== null;
}
