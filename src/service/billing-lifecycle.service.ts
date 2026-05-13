import type { PrismaClient } from '@prisma/client';
import {
  getAccountsOverdueForAutoClose,
  getAccountsDueForReminder,
  updateReminderSentDate,
} from '../db/queries/payment-due-schedule.queries.js';
import { closeAccount } from './account.service.js';
import { PixiCredError } from '../lib/errors.js';
import type { ServiceClients } from '../types/index.js';

export async function runBillingLifecycle(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { lookaheadDays: number },
): Promise<{ closedCount: number; remindedCount: number }> {
  if (!Number.isInteger(input.lookaheadDays) || input.lookaheadDays < 1) {
    throw new PixiCredError('VALIDATION_ERROR', 'lookaheadDays must be an integer >= 1');
  }

  const todayIso = new Date().toISOString().slice(0, 10) as string;

  // Sweep 1 — auto-close (runs FIRST per FR-BILL-05)
  const overdueAccounts = await getAccountsOverdueForAutoClose(prisma, todayIso);
  for (const { accountId } of overdueAccounts) {
    await closeAccount(prisma, clients, { accountId, reason: 'AUTO_NONPAYMENT' });
  }

  // Sweep 2 — reminders (runs SECOND — closed accounts excluded by status filter)
  const dueAccounts = await getAccountsDueForReminder(prisma, todayIso, input.lookaheadDays);
  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  for (const { accountId } of dueAccounts) {
    // Stamp BEFORE publish so a failed publish doesn't re-remind (FR-BILL-07)
    await updateReminderSentDate(prisma, accountId, todayIso);
    await clients.snsClient.publishEvent(topicArn, 'PAYMENT_DUE_REMINDER', { accountId });
  }

  return { closedCount: overdueAccounts.length, remindedCount: dueAccounts.length };
}
