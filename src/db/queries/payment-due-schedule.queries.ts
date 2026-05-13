import { PrismaClient } from '@prisma/client';
import type { PaymentDueSchedule } from '../../types/index';

function mapSchedule(row: {
  accountId: string;
  paymentDueDate: Date;
  satisfied: boolean;
  satisfiedAt: Date | null;
  reminderSentDate: Date | null;
  createdAt: Date;
}): PaymentDueSchedule {
  return {
    accountId: row.accountId,
    paymentDueDate: row.paymentDueDate.toISOString().split('T')[0] as string,
    satisfied: row.satisfied,
    satisfiedAt: row.satisfiedAt,
    reminderSentDate: row.reminderSentDate
      ? (row.reminderSentDate.toISOString().split('T')[0] as string)
      : null,
    createdAt: row.createdAt,
  };
}

export async function createPaymentDueSchedule(
  prisma: PrismaClient,
  accountId: string,
  paymentDueDate: string,
): Promise<PaymentDueSchedule> {
  const row = await prisma.paymentDueSchedule.create({
    data: {
      accountId,
      paymentDueDate: new Date(paymentDueDate + 'T00:00:00Z'),
    },
  });
  return mapSchedule(row);
}

export async function getPaymentDueScheduleByAccountId(
  prisma: PrismaClient,
  accountId: string,
): Promise<PaymentDueSchedule | null> {
  const row = await prisma.paymentDueSchedule.findUnique({ where: { accountId } });
  return row ? mapSchedule(row) : null;
}

export async function markPaymentDueScheduleSatisfied(
  prisma: PrismaClient,
  accountId: string,
): Promise<PaymentDueSchedule> {
  const existing = await prisma.paymentDueSchedule.findUniqueOrThrow({ where: { accountId } });
  if (existing.satisfied) return mapSchedule(existing);
  const row = await prisma.paymentDueSchedule.update({
    where: { accountId },
    data: { satisfied: true, satisfiedAt: new Date() },
  });
  return mapSchedule(row);
}

export async function updateReminderSentDate(
  prisma: PrismaClient,
  accountId: string,
  date: string,
): Promise<PaymentDueSchedule> {
  const row = await prisma.paymentDueSchedule.update({
    where: { accountId },
    data: { reminderSentDate: new Date(date + 'T00:00:00Z') },
  });
  return mapSchedule(row);
}

export async function getAccountsDueForReminder(
  prisma: PrismaClient,
  todayIso: string,
  lookaheadDays: number,
): Promise<Array<{ accountId: string; holderEmail: string; paymentDueDate: string; currentBalance: number }>> {
  const today = new Date(todayIso + 'T00:00:00Z');
  const lookaheadDate = new Date(today);
  lookaheadDate.setUTCDate(lookaheadDate.getUTCDate() + lookaheadDays);

  const rows = await prisma.paymentDueSchedule.findMany({
    where: {
      satisfied: false,
      paymentDueDate: { lte: lookaheadDate },
      account: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
      OR: [{ reminderSentDate: null }, { reminderSentDate: { lt: today } }],
    },
    include: {
      account: { select: { holderEmail: true, currentBalance: true } },
    },
  });

  return rows.map((r) => ({
    accountId: r.accountId,
    holderEmail: r.account.holderEmail,
    paymentDueDate: r.paymentDueDate.toISOString().split('T')[0] as string,
    currentBalance: r.account.currentBalance.toNumber(),
  }));
}

export async function getAccountsOverdueForAutoClose(
  prisma: PrismaClient,
  todayIso: string,
): Promise<Array<{ accountId: string; holderEmail: string }>> {
  const today = new Date(todayIso + 'T00:00:00Z');
  const cutoffDate = new Date(today);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);

  const rows = await prisma.paymentDueSchedule.findMany({
    where: {
      satisfied: false,
      paymentDueDate: { lt: cutoffDate },
      account: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
    },
    include: {
      account: { select: { holderEmail: true } },
    },
  });

  return rows.map((r) => ({
    accountId: r.accountId,
    holderEmail: r.account.holderEmail,
  }));
}
