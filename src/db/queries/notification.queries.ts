import { PrismaClient } from '@prisma/client';
import type { NotificationPreference } from '../../types/index';

export interface UpdateNotificationPrefsInput {
  accountId: string;
  transactionsEnabled?: boolean;
  statementsEnabled?: boolean;
  paymentRemindersEnabled?: boolean;
}

function mapPrefs(row: {
  accountId: string;
  transactionsEnabled: boolean;
  statementsEnabled: boolean;
  paymentRemindersEnabled: boolean;
  updatedAt: Date;
}): NotificationPreference {
  return {
    accountId: row.accountId,
    transactionsEnabled: row.transactionsEnabled,
    statementsEnabled: row.statementsEnabled,
    paymentRemindersEnabled: row.paymentRemindersEnabled,
    updatedAt: row.updatedAt,
  };
}

export async function createNotificationPreferences(
  prisma: PrismaClient,
  accountId: string,
): Promise<NotificationPreference> {
  const row = await prisma.notificationPreference.create({ data: { accountId } });
  return mapPrefs(row);
}

export async function getNotificationPreferences(
  prisma: PrismaClient,
  accountId: string,
): Promise<NotificationPreference | null> {
  const row = await prisma.notificationPreference.findUnique({ where: { accountId } });
  return row ? mapPrefs(row) : null;
}

export async function updateNotificationPreferences(
  prisma: PrismaClient,
  input: UpdateNotificationPrefsInput,
): Promise<NotificationPreference> {
  const row = await prisma.notificationPreference.update({
    where: { accountId: input.accountId },
    data: {
      ...(input.transactionsEnabled !== undefined
        ? { transactionsEnabled: input.transactionsEnabled }
        : {}),
      ...(input.statementsEnabled !== undefined
        ? { statementsEnabled: input.statementsEnabled }
        : {}),
      ...(input.paymentRemindersEnabled !== undefined
        ? { paymentRemindersEnabled: input.paymentRemindersEnabled }
        : {}),
    },
  });
  return mapPrefs(row);
}
