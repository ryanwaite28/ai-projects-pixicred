import { PrismaClient } from '@prisma/client';
import type { Application, ApplicationStatus } from '../../types/index';

export interface CreateApplicationInput {
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  annualIncome: number;
  mockSsn: string;
}

function mapApplication(row: {
  applicationId: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  annualIncome: { toNumber(): number };
  mockSsn: string;
  status: string;
  creditLimit: { toNumber(): number } | null;
  createdAt: Date;
  decidedAt: Date | null;
}): Application {
  return {
    applicationId: row.applicationId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth.toISOString().split('T')[0] as string,
    annualIncome: row.annualIncome.toNumber(),
    mockSsn: row.mockSsn,
    status: row.status as ApplicationStatus,
    creditLimit: row.creditLimit !== null ? row.creditLimit.toNumber() : null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export async function createApplication(
  prisma: PrismaClient,
  input: CreateApplicationInput,
): Promise<Application> {
  const row = await prisma.application.create({
    data: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: new Date(input.dateOfBirth + 'T00:00:00Z'),
      annualIncome: input.annualIncome,
      mockSsn: input.mockSsn,
    },
  });
  return mapApplication(row);
}

export async function getApplicationById(
  prisma: PrismaClient,
  applicationId: string,
): Promise<Application | null> {
  const row = await prisma.application.findUnique({ where: { applicationId } });
  return row ? mapApplication(row) : null;
}

export async function getActiveApplicationOrAccountByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<{ type: 'application' | 'account'; status: string } | null> {
  // Block if PENDING application exists
  const pendingApp = await prisma.application.findFirst({
    where: { email, status: 'PENDING' },
    select: { status: true },
  });
  if (pendingApp) return { type: 'application', status: 'PENDING' };

  // Block if ACTIVE or SUSPENDED account exists
  const activeAccount = await prisma.account.findFirst({
    where: { holderEmail: email, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    select: { status: true },
  });
  if (activeAccount) return { type: 'account', status: activeAccount.status };

  // Block if APPROVED application exists but no account has been created yet
  // (brief window between approval decision and account creation, inside atomic tx)
  // Per FR-APP-09: once the account reaches CLOSED status, re-application is allowed
  const orphanApprovedApp = await prisma.application.findFirst({
    where: { email, status: 'APPROVED', account: null },
    select: { status: true },
  });
  if (orphanApprovedApp) return { type: 'application', status: 'APPROVED' };

  return null;
}

export async function updateApplicationStatus(
  prisma: PrismaClient,
  applicationId: string,
  status: ApplicationStatus,
  creditLimit?: number,
): Promise<Application> {
  const row = await prisma.application.update({
    where: { applicationId },
    data: {
      status,
      decidedAt: new Date(),
      ...(creditLimit !== undefined ? { creditLimit } : {}),
    },
  });
  return mapApplication(row);
}
