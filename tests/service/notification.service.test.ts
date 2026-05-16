import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestPrisma, cleanTables } from '../db/helpers';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  sendDeclineEmail,
  sendApprovalEmail,
  sendTransactionEmail,
  sendStatementEmail,
  sendPaymentDueReminderEmail,
  sendAutoCloseEmail,
  sendUserCloseEmail,
} from '../../src/service/notification.service';
import { createApplication, updateApplicationStatus } from '../../src/db/queries/application.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { createTransaction } from '../../src/db/queries/transaction.queries';
import { createStatement } from '../../src/db/queries/statement.queries';
import { createPaymentDueSchedule } from '../../src/db/queries/payment-due-schedule.queries';
import { createNotificationPreferences } from '../../src/db/queries/notification.queries';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
const clients = {
  sesClient: { sendEmail: mockSendEmail },
  snsClient: { publishEvent: vi.fn().mockResolvedValue(undefined) },
  sqsClient: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  portalBaseUrl: 'https://pixicred.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

let counter = 0;
async function makeApplication(opts: { declined?: boolean } = {}) {
  counter++;
  const email = `user${counter}@example.com`;
  const mockSsn = opts.declined ? '54315' : '12345';
  return createApplication(prisma, {
    email,
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-06-15',
    annualIncome: 75000,
    mockSsn,
  });
}

async function makeApprovedWithAccount() {
  const app = await makeApplication();
  await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 7500);
  const account = await createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: app.email,
    creditLimit: 7500,
    paymentDueDate: '2026-06-25',
    cardNumber: `${counter}`.padStart(16, '0'),
    cardExpiry: new Date('2029-06-01T00:00:00Z'),
    cardCvv: '123',
  });
  await createPaymentDueSchedule(prisma, account.accountId, '2026-06-25');
  await createNotificationPreferences(prisma, account.accountId);
  return { app, account };
}

async function makeTransaction(accountId: string) {
  counter++;
  return createTransaction(prisma, {
    accountId,
    type: 'CHARGE',
    merchantName: 'Test Store',
    amount: 100,
    idempotencyKey: `key-tx-${counter}`,
    status: 'PROCESSING',
  });
}

async function makeStatement(accountId: string) {
  return createStatement(prisma, {
    accountId,
    periodStart: new Date('2026-05-01T00:00:00Z'),
    periodEnd: new Date('2026-06-01T00:00:00Z'),
    openingBalance: 500,
    closingBalance: 650,
    totalCharges: 150,
    totalPayments: 0,
    minimumPaymentDue: 25,
    dueDate: '2026-06-25',
  });
}

const NON_EXISTENT_ID = '00000000-0000-4000-8000-000000000099';

// ─── getNotificationPreferences ──────────────────────────────────────────────

describe('getNotificationPreferences', () => {
  it('returns preferences for valid accountId', async () => {
    const { account } = await makeApprovedWithAccount();
    const prefs = await getNotificationPreferences(prisma, clients, { accountId: account.accountId });
    expect(prefs.accountId).toBe(account.accountId);
    expect(typeof prefs.transactionsEnabled).toBe('boolean');
    expect(typeof prefs.statementsEnabled).toBe('boolean');
    expect(typeof prefs.paymentRemindersEnabled).toBe('boolean');
  });

  it('throws ACCOUNT_NOT_FOUND when no preferences record exists', async () => {
    await expect(
      getNotificationPreferences(prisma, clients, { accountId: NON_EXISTENT_ID }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('throws VALIDATION_ERROR for non-UUID accountId', async () => {
    await expect(
      getNotificationPreferences(prisma, clients, { accountId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ─── updateNotificationPreferences ───────────────────────────────────────────

describe('updateNotificationPreferences', () => {
  it('sets transactionsEnabled to false', async () => {
    const { account } = await makeApprovedWithAccount();
    const prefs = await updateNotificationPreferences(prisma, clients, {
      accountId: account.accountId,
      transactionsEnabled: false,
    });
    expect(prefs.transactionsEnabled).toBe(false);
  });

  it('sets statementsEnabled to false', async () => {
    const { account } = await makeApprovedWithAccount();
    const prefs = await updateNotificationPreferences(prisma, clients, {
      accountId: account.accountId,
      statementsEnabled: false,
    });
    expect(prefs.statementsEnabled).toBe(false);
  });

  it('sets paymentRemindersEnabled to false', async () => {
    const { account } = await makeApprovedWithAccount();
    const prefs = await updateNotificationPreferences(prisma, clients, {
      accountId: account.accountId,
      paymentRemindersEnabled: false,
    });
    expect(prefs.paymentRemindersEnabled).toBe(false);
  });

  it('performs partial update — unspecified fields unchanged', async () => {
    const { account } = await makeApprovedWithAccount();
    await updateNotificationPreferences(prisma, clients, {
      accountId: account.accountId,
      transactionsEnabled: false,
    });
    const prefs = await getNotificationPreferences(prisma, clients, { accountId: account.accountId });
    expect(prefs.transactionsEnabled).toBe(false);
    expect(prefs.statementsEnabled).toBe(true);
    expect(prefs.paymentRemindersEnabled).toBe(true);
  });

  it('throws VALIDATION_ERROR when no preference fields are provided', async () => {
    const { account } = await makeApprovedWithAccount();
    await expect(
      updateNotificationPreferences(prisma, clients, { accountId: account.accountId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR for non-UUID accountId', async () => {
    await expect(
      updateNotificationPreferences(prisma, clients, { accountId: 'bad', transactionsEnabled: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ─── sendDeclineEmail ─────────────────────────────────────────────────────────

describe('sendDeclineEmail', () => {
  it('calls sesClient.sendEmail with correct recipient and body', async () => {
    const app = await makeApplication({ declined: true });
    await updateApplicationStatus(prisma, app.applicationId, 'DECLINED');
    await sendDeclineEmail(prisma, clients, { applicationId: app.applicationId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const call = mockSendEmail.mock.calls[0]![0] as { to: string; subject: string };
    expect(call.to).toBe(app.email);
    expect(call.subject).toBeTruthy();
  });

  it('returns void without throwing when application does not exist — defensive guard', async () => {
    await expect(
      sendDeclineEmail(prisma, clients, { applicationId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const app = await makeApplication({ declined: true });
    await updateApplicationStatus(prisma, app.applicationId, 'DECLINED');
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendDeclineEmail(prisma, clients, { applicationId: app.applicationId }),
    ).resolves.toBeUndefined();
  });
});

// ─── sendApprovalEmail ────────────────────────────────────────────────────────

describe('sendApprovalEmail', () => {
  it('calls sesClient.sendEmail with creditLimit and paymentDueDate in body', async () => {
    const { app, account } = await makeApprovedWithAccount();
    await sendApprovalEmail(prisma, clients, { applicationId: app.applicationId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const call = mockSendEmail.mock.calls[0]![0] as { to: string; textBody: string };
    expect(call.to).toBe(app.email);
    expect(call.textBody).toMatch(/7500|7,500/);
    expect(call.textBody).toContain(account.paymentDueDate);
  });

  it('returns void without throwing when application does not exist — defensive guard', async () => {
    await expect(
      sendApprovalEmail(prisma, clients, { applicationId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns void without throwing when account does not exist — defensive guard', async () => {
    const app = await makeApplication();
    await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 7500);
    // No account created for this application
    await expect(
      sendApprovalEmail(prisma, clients, { applicationId: app.applicationId }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const { app } = await makeApprovedWithAccount();
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendApprovalEmail(prisma, clients, { applicationId: app.applicationId }),
    ).resolves.toBeUndefined();
  });
});

// ─── sendTransactionEmail ─────────────────────────────────────────────────────

describe('sendTransactionEmail', () => {
  it('calls sesClient.sendEmail when transactionsEnabled is true', async () => {
    const { account } = await makeApprovedWithAccount();
    const tx = await makeTransaction(account.accountId);
    await sendTransactionEmail(prisma, clients, { transactionId: tx.transactionId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('returns void without calling sesClient when transactionsEnabled is false', async () => {
    const { account } = await makeApprovedWithAccount();
    const tx = await makeTransaction(account.accountId);
    await prisma.notificationPreference.update({
      where: { accountId: account.accountId },
      data: { transactionsEnabled: false },
    });
    await sendTransactionEmail(prisma, clients, { transactionId: tx.transactionId });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns void without throwing when transaction does not exist — defensive guard', async () => {
    await expect(
      sendTransactionEmail(prisma, clients, { transactionId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const { account } = await makeApprovedWithAccount();
    const tx = await makeTransaction(account.accountId);
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendTransactionEmail(prisma, clients, { transactionId: tx.transactionId }),
    ).resolves.toBeUndefined();
  });
});

// ─── sendStatementEmail ───────────────────────────────────────────────────────

describe('sendStatementEmail', () => {
  it('calls sesClient.sendEmail when statementsEnabled is true', async () => {
    const { account } = await makeApprovedWithAccount();
    const stmt = await makeStatement(account.accountId);
    await sendStatementEmail(prisma, clients, { statementId: stmt.statementId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('returns void without calling sesClient when statementsEnabled is false', async () => {
    const { account } = await makeApprovedWithAccount();
    const stmt = await makeStatement(account.accountId);
    await prisma.notificationPreference.update({
      where: { accountId: account.accountId },
      data: { statementsEnabled: false },
    });
    await sendStatementEmail(prisma, clients, { statementId: stmt.statementId });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns void without throwing when statement does not exist — defensive guard', async () => {
    await expect(
      sendStatementEmail(prisma, clients, { statementId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const { account } = await makeApprovedWithAccount();
    const stmt = await makeStatement(account.accountId);
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendStatementEmail(prisma, clients, { statementId: stmt.statementId }),
    ).resolves.toBeUndefined();
  });
});

// ─── sendPaymentDueReminderEmail ──────────────────────────────────────────────

describe('sendPaymentDueReminderEmail', () => {
  it('calls sesClient.sendEmail when paymentRemindersEnabled is true', async () => {
    const { account } = await makeApprovedWithAccount();
    await sendPaymentDueReminderEmail(prisma, clients, { accountId: account.accountId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('returns void without calling sesClient when paymentRemindersEnabled is false', async () => {
    const { account } = await makeApprovedWithAccount();
    await prisma.notificationPreference.update({
      where: { accountId: account.accountId },
      data: { paymentRemindersEnabled: false },
    });
    await sendPaymentDueReminderEmail(prisma, clients, { accountId: account.accountId });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns void without throwing when account does not exist — defensive guard', async () => {
    await expect(
      sendPaymentDueReminderEmail(prisma, clients, { accountId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const { account } = await makeApprovedWithAccount();
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendPaymentDueReminderEmail(prisma, clients, { accountId: account.accountId }),
    ).resolves.toBeUndefined();
  });
});

// ─── sendAutoCloseEmail ───────────────────────────────────────────────────────

describe('sendAutoCloseEmail', () => {
  it('calls sesClient.sendEmail regardless of notification preferences', async () => {
    const { account } = await makeApprovedWithAccount();
    await prisma.notificationPreference.update({
      where: { accountId: account.accountId },
      data: { transactionsEnabled: false, statementsEnabled: false, paymentRemindersEnabled: false },
    });
    await sendAutoCloseEmail(prisma, clients, { accountId: account.accountId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('returns void without throwing when account does not exist — defensive guard', async () => {
    await expect(
      sendAutoCloseEmail(prisma, clients, { accountId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const { account } = await makeApprovedWithAccount();
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendAutoCloseEmail(prisma, clients, { accountId: account.accountId }),
    ).resolves.toBeUndefined();
  });
});

// ─── sendUserCloseEmail ───────────────────────────────────────────────────────

describe('sendUserCloseEmail', () => {
  it('calls sesClient.sendEmail regardless of notification preferences', async () => {
    const { account } = await makeApprovedWithAccount();
    await prisma.notificationPreference.update({
      where: { accountId: account.accountId },
      data: { transactionsEnabled: false, statementsEnabled: false, paymentRemindersEnabled: false },
    });
    await sendUserCloseEmail(prisma, clients, { accountId: account.accountId });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('returns void without throwing when account does not exist — defensive guard', async () => {
    await expect(
      sendUserCloseEmail(prisma, clients, { accountId: NON_EXISTENT_ID }),
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('catches sesClient error and does not rethrow — FR-NOTIF-06', async () => {
    const { account } = await makeApprovedWithAccount();
    mockSendEmail.mockRejectedValueOnce(new Error('SES failure'));
    await expect(
      sendUserCloseEmail(prisma, clients, { accountId: account.accountId }),
    ).resolves.toBeUndefined();
  });
});
