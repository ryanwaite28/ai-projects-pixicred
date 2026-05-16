import type { PrismaClient } from '@prisma/client';
import { PixiCredError } from '../lib/errors.js';
import { assertUuid } from '../lib/validate.js';
import { log } from '../lib/logger.js';
import { getApplicationById } from '../db/queries/application.queries.js';
import { getAccountById, getAccountByApplicationId } from '../db/queries/account.queries.js';
import { getTransactionById } from '../db/queries/transaction.queries.js';
import { getStatementByIdOnly } from '../db/queries/statement.queries.js';
import { getPaymentDueScheduleByAccountId } from '../db/queries/payment-due-schedule.queries.js';
import {
  getNotificationPreferences as queryGetPrefs,
  updateNotificationPreferences as queryUpdatePrefs,
} from '../db/queries/notification.queries.js';
import { buildDeclineEmail } from '../emails/decline.template.js';
import { buildApprovalEmail } from '../emails/approval.template.js';
import { buildTransactionEmail } from '../emails/transaction.template.js';
import { buildChargeCreatedEmail } from '../emails/charge-created.template.js';
import { buildChargePostedEmail } from '../emails/charge-posted.template.js';
import { buildDisputeConfirmationEmail } from '../emails/dispute-confirmation.template.js';
import { buildDisputeResolutionEmail } from '../emails/dispute-resolution.template.js';
import { buildStatementEmail } from '../emails/statement.template.js';
import { buildPaymentDueReminderEmail } from '../emails/payment-due-reminder.template.js';
import { buildAutoCloseEmail } from '../emails/auto-close.template.js';
import { buildUserCloseEmail } from '../emails/user-close.template.js';
import { buildApplicationSubmittedEmail } from '../emails/application-submitted.template.js';
import type {
  NotificationPreference,
  ServiceClients,
  UpdateNotificationPrefsInput,
} from '../types/index.js';

export async function getNotificationPreferences(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { accountId: string },
): Promise<NotificationPreference> {
  assertUuid(input.accountId, 'accountId');
  const prefs = await queryGetPrefs(prisma, input.accountId);
  if (!prefs) throw new PixiCredError('ACCOUNT_NOT_FOUND', `No notification preferences found for account ${input.accountId}`);
  return prefs;
}

export async function updateNotificationPreferences(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: UpdateNotificationPrefsInput,
): Promise<NotificationPreference> {
  assertUuid(input.accountId, 'accountId');
  const hasField =
    input.transactionsEnabled !== undefined ||
    input.statementsEnabled !== undefined ||
    input.paymentRemindersEnabled !== undefined;
  if (!hasField) {
    throw new PixiCredError('VALIDATION_ERROR', 'At least one preference field must be provided');
  }
  return queryUpdatePrefs(prisma, input);
}

export async function sendDeclineEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { applicationId: string },
): Promise<void> {
  assertUuid(input.applicationId, 'applicationId');
  const application = await getApplicationById(prisma, input.applicationId);
  if (!application) {
    log('warn', 'sendDeclineEmail', 0, { note: 'application not found', applicationId: input.applicationId });
    return;
  }
  const email = buildDeclineEmail(application);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendDeclineEmail', 0, { error: String(e), applicationId: input.applicationId });
  }
}

export async function sendApprovalEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { applicationId: string },
): Promise<void> {
  assertUuid(input.applicationId, 'applicationId');
  const application = await getApplicationById(prisma, input.applicationId);
  if (!application) {
    log('warn', 'sendApprovalEmail', 0, { note: 'application not found', applicationId: input.applicationId });
    return;
  }
  const account = await getAccountByApplicationId(prisma, input.applicationId);
  if (!account) {
    log('warn', 'sendApprovalEmail', 0, { note: 'account not found for application', applicationId: input.applicationId });
    return;
  }
  const email = buildApprovalEmail(application, account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendApprovalEmail', 0, { error: String(e), applicationId: input.applicationId });
  }
}

export async function sendTransactionEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { transactionId: string },
): Promise<void> {
  assertUuid(input.transactionId, 'transactionId');
  const transaction = await getTransactionById(prisma, input.transactionId);
  if (!transaction) {
    log('warn', 'sendTransactionEmail', 0, { note: 'transaction not found', transactionId: input.transactionId });
    return;
  }
  const account = await getAccountById(prisma, transaction.accountId);
  if (!account) {
    log('warn', 'sendTransactionEmail', 0, { note: 'account not found', accountId: transaction.accountId });
    return;
  }
  const prefs = await queryGetPrefs(prisma, account.accountId);
  if (prefs?.transactionsEnabled === false) {
    log('info', 'sendTransactionEmail', 0, { note: 'suppressed by preference', accountId: account.accountId });
    return;
  }
  // TRANSACTION_POSTED for CHARGE type (settled by settlement job) uses the charge-posted template
  const email = transaction.type === 'CHARGE'
    ? buildChargePostedEmail(transaction, account, clients.portalBaseUrl)
    : buildTransactionEmail(transaction, account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendTransactionEmail', 0, { error: String(e), transactionId: input.transactionId });
  }
}

export async function sendStatementEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { statementId: string },
): Promise<void> {
  assertUuid(input.statementId, 'statementId');
  const statement = await getStatementByIdOnly(prisma, input.statementId);
  if (!statement) {
    log('warn', 'sendStatementEmail', 0, { note: 'statement not found', statementId: input.statementId });
    return;
  }
  const account = await getAccountById(prisma, statement.accountId);
  if (!account) {
    log('warn', 'sendStatementEmail', 0, { note: 'account not found', accountId: statement.accountId });
    return;
  }
  const prefs = await queryGetPrefs(prisma, account.accountId);
  if (prefs?.statementsEnabled === false) {
    log('info', 'sendStatementEmail', 0, { note: 'suppressed by preference', accountId: account.accountId });
    return;
  }
  const email = buildStatementEmail(statement, account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendStatementEmail', 0, { error: String(e), statementId: input.statementId });
  }
}

export async function sendPaymentDueReminderEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string },
): Promise<void> {
  assertUuid(input.accountId, 'accountId');
  const account = await getAccountById(prisma, input.accountId);
  if (!account) {
    log('warn', 'sendPaymentDueReminderEmail', 0, { note: 'account not found', accountId: input.accountId });
    return;
  }
  const schedule = await getPaymentDueScheduleByAccountId(prisma, input.accountId);
  if (!schedule) {
    log('warn', 'sendPaymentDueReminderEmail', 0, { note: 'payment due schedule not found', accountId: input.accountId });
    return;
  }
  const prefs = await queryGetPrefs(prisma, input.accountId);
  if (prefs?.paymentRemindersEnabled === false) {
    log('info', 'sendPaymentDueReminderEmail', 0, { note: 'suppressed by preference', accountId: input.accountId });
    return;
  }
  const email = buildPaymentDueReminderEmail(account, schedule, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendPaymentDueReminderEmail', 0, { error: String(e), accountId: input.accountId });
  }
}

export async function sendAutoCloseEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string },
): Promise<void> {
  assertUuid(input.accountId, 'accountId');
  const account = await getAccountById(prisma, input.accountId);
  if (!account) {
    log('warn', 'sendAutoCloseEmail', 0, { note: 'account not found', accountId: input.accountId });
    return;
  }
  const email = buildAutoCloseEmail(account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendAutoCloseEmail', 0, { error: String(e), accountId: input.accountId });
  }
}

export async function sendUserCloseEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string },
): Promise<void> {
  assertUuid(input.accountId, 'accountId');
  const account = await getAccountById(prisma, input.accountId);
  if (!account) {
    log('warn', 'sendUserCloseEmail', 0, { note: 'account not found', accountId: input.accountId });
    return;
  }
  const email = buildUserCloseEmail(account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendUserCloseEmail', 0, { error: String(e), accountId: input.accountId });
  }
}

export async function sendApplicationSubmittedEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { applicationId: string },
): Promise<void> {
  assertUuid(input.applicationId, 'applicationId');
  const application = await getApplicationById(prisma, input.applicationId);
  if (!application) {
    log('warn', 'sendApplicationSubmittedEmail', 0, { note: 'application not found', applicationId: input.applicationId });
    return;
  }
  const email = buildApplicationSubmittedEmail(application, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendApplicationSubmittedEmail', 0, { error: String(e), applicationId: input.applicationId });
  }
}

export async function sendChargeCreatedEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { transactionId: string },
): Promise<void> {
  assertUuid(input.transactionId, 'transactionId');
  const transaction = await getTransactionById(prisma, input.transactionId);
  if (!transaction) {
    log('warn', 'sendChargeCreatedEmail', 0, { note: 'transaction not found', transactionId: input.transactionId });
    return;
  }
  const account = await getAccountById(prisma, transaction.accountId);
  if (!account) {
    log('warn', 'sendChargeCreatedEmail', 0, { note: 'account not found', accountId: transaction.accountId });
    return;
  }
  const prefs = await queryGetPrefs(prisma, account.accountId);
  if (prefs?.transactionsEnabled === false) {
    log('info', 'sendChargeCreatedEmail', 0, { note: 'suppressed by preference', accountId: account.accountId });
    return;
  }
  const email = buildChargeCreatedEmail(transaction, account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendChargeCreatedEmail', 0, { error: String(e), transactionId: input.transactionId });
  }
}

export async function sendChargePostedEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { transactionId: string },
): Promise<void> {
  assertUuid(input.transactionId, 'transactionId');
  const transaction = await getTransactionById(prisma, input.transactionId);
  if (!transaction) {
    log('warn', 'sendChargePostedEmail', 0, { note: 'transaction not found', transactionId: input.transactionId });
    return;
  }
  const account = await getAccountById(prisma, transaction.accountId);
  if (!account) {
    log('warn', 'sendChargePostedEmail', 0, { note: 'account not found', accountId: transaction.accountId });
    return;
  }
  const prefs = await queryGetPrefs(prisma, account.accountId);
  if (prefs?.transactionsEnabled === false) {
    log('info', 'sendChargePostedEmail', 0, { note: 'suppressed by preference', accountId: account.accountId });
    return;
  }
  const email = buildChargePostedEmail(transaction, account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendChargePostedEmail', 0, { error: String(e), transactionId: input.transactionId });
  }
}

export async function sendDisputeConfirmationEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { transactionId: string },
): Promise<void> {
  assertUuid(input.transactionId, 'transactionId');
  const transaction = await getTransactionById(prisma, input.transactionId);
  if (!transaction) {
    log('warn', 'sendDisputeConfirmationEmail', 0, { note: 'transaction not found', transactionId: input.transactionId });
    return;
  }
  const account = await getAccountById(prisma, transaction.accountId);
  if (!account) {
    log('warn', 'sendDisputeConfirmationEmail', 0, { note: 'account not found', accountId: transaction.accountId });
    return;
  }
  // No preference gate — always delivered (FR-NOTIF-07)
  const email = buildDisputeConfirmationEmail(transaction, account, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendDisputeConfirmationEmail', 0, { error: String(e), transactionId: input.transactionId });
  }
}

export async function sendDisputeResolutionEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { transactionId: string; outcome: 'DISPUTE_ACCEPTED' | 'DISPUTE_DENIED' },
): Promise<void> {
  assertUuid(input.transactionId, 'transactionId');
  const transaction = await getTransactionById(prisma, input.transactionId);
  if (!transaction) {
    log('warn', 'sendDisputeResolutionEmail', 0, { note: 'transaction not found', transactionId: input.transactionId });
    return;
  }
  const account = await getAccountById(prisma, transaction.accountId);
  if (!account) {
    log('warn', 'sendDisputeResolutionEmail', 0, { note: 'account not found', accountId: transaction.accountId });
    return;
  }
  // No preference gate — always delivered (FR-NOTIF-07)
  const email = buildDisputeResolutionEmail(transaction, account, input.outcome, clients.portalBaseUrl);
  try {
    await clients.sesClient.sendEmail(email);
  } catch (e) {
    log('error', 'sendDisputeResolutionEmail', 0, { error: String(e), transactionId: input.transactionId });
  }
}
