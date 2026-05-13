import { PrismaClient } from '@prisma/client';
import type { Account, AccountStatus, CloseReason } from '../../types/index';

export interface CreateAccountInput {
  applicationId: string;
  holderEmail: string;
  creditLimit: number;
  paymentDueDate: string;
}

function mapAccount(row: {
  accountId: string;
  applicationId: string;
  holderEmail: string;
  creditLimit: { toNumber(): number };
  currentBalance: { toNumber(): number };
  status: string;
  paymentDueDate: Date;
  closeReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
}): Account {
  const creditLimit = row.creditLimit.toNumber();
  const currentBalance = row.currentBalance.toNumber();
  return {
    accountId: row.accountId,
    applicationId: row.applicationId,
    holderEmail: row.holderEmail,
    creditLimit,
    currentBalance,
    availableCredit: creditLimit - currentBalance,
    status: row.status as AccountStatus,
    paymentDueDate: row.paymentDueDate.toISOString().split('T')[0] as string,
    closeReason: (row.closeReason as CloseReason | null) ?? null,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
  };
}

export async function createAccount(
  prisma: PrismaClient,
  input: CreateAccountInput,
): Promise<Account> {
  const row = await prisma.account.create({
    data: {
      applicationId: input.applicationId,
      holderEmail: input.holderEmail,
      creditLimit: input.creditLimit,
      paymentDueDate: new Date(input.paymentDueDate + 'T00:00:00Z'),
    },
  });
  return mapAccount(row);
}

export async function getAccountById(
  prisma: PrismaClient,
  accountId: string,
): Promise<Account | null> {
  const row = await prisma.account.findUnique({ where: { accountId } });
  return row ? mapAccount(row) : null;
}

export async function updateAccountStatus(
  prisma: PrismaClient,
  accountId: string,
  status: AccountStatus,
  closeReason?: CloseReason,
): Promise<Account> {
  const row = await prisma.account.update({
    where: { accountId },
    data: {
      status,
      ...(status === 'CLOSED' ? { closeReason: closeReason ?? null, closedAt: new Date() } : {}),
    },
  });
  return mapAccount(row);
}

export async function updateAccountBalance(
  prisma: PrismaClient,
  accountId: string,
  newBalance: number,
): Promise<Account> {
  const row = await prisma.account.update({
    where: { accountId },
    data: { currentBalance: newBalance },
  });
  return mapAccount(row);
}

export async function getAccountsForStatements(
  prisma: PrismaClient,
): Promise<Account[]> {
  const rows = await prisma.account.findMany({
    where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
  });
  return rows.map(mapAccount);
}

export async function getAccountByApplicationId(
  prisma: PrismaClient,
  applicationId: string,
): Promise<Account | null> {
  const row = await prisma.account.findFirst({ where: { applicationId } });
  return row ? mapAccount(row) : null;
}

export async function getActiveAccountByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<Account | null> {
  const row = await prisma.account.findFirst({
    where: { holderEmail: email, status: { in: ['ACTIVE', 'SUSPENDED'] } },
  });
  return row ? mapAccount(row) : null;
}
