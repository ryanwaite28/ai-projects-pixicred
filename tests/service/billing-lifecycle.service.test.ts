import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestPrisma, cleanTables } from '../db/helpers';
import { runBillingLifecycle } from '../../src/service/billing-lifecycle.service';
import { createApplication, updateApplicationStatus } from '../../src/db/queries/application.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { createPaymentDueSchedule } from '../../src/db/queries/payment-due-schedule.queries';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

const mockSnsPublish = vi.fn().mockResolvedValue(undefined);
const clients = {
  sesClient: { sendEmail: vi.fn().mockResolvedValue(undefined) },
  snsClient: { publishEvent: mockSnsPublish },
  sqsClient: { sendMessage: vi.fn().mockResolvedValue(undefined) },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:000000000000:topic';
});

// Returns today's ISO date string
function todayIso(): string {
  return new Date().toISOString().slice(0, 10) as string;
}

// Returns an ISO date N days from today (negative = past)
function daysFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10) as string;
}

let emailCounter = 0;
async function makeAccount(opts: {
  paymentDueDateIso: string;
  status?: string;
  satisfied?: boolean;
  currentBalance?: number;
  reminderSentDate?: string;
} = { paymentDueDateIso: daysFromToday(7) }) {
  emailCounter++;
  const email = `user${emailCounter}@example.com`;
  const app = await createApplication(prisma, {
    email,
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-06-15',
    annualIncome: 75000,
    mockSsn: '12345',
  });
  await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 7500);
  const account = await createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: email,
    creditLimit: 7500,
    paymentDueDate: opts.paymentDueDateIso,
  });

  if (opts.status && opts.status !== 'ACTIVE') {
    await prisma.account.update({
      where: { accountId: account.accountId },
      data: {
        status: opts.status,
        ...(opts.status === 'CLOSED'
          ? { closeReason: 'USER_REQUESTED', closedAt: new Date() }
          : {}),
      },
    });
  }
  if (opts.currentBalance !== undefined && opts.currentBalance !== 500) {
    await prisma.account.update({
      where: { accountId: account.accountId },
      data: { currentBalance: opts.currentBalance },
    });
  }

  const schedule = await createPaymentDueSchedule(prisma, account.accountId, opts.paymentDueDateIso);

  if (opts.satisfied) {
    await prisma.paymentDueSchedule.update({
      where: { accountId: account.accountId },
      data: { satisfied: true, satisfiedAt: new Date() },
    });
  }
  if (opts.reminderSentDate) {
    await prisma.paymentDueSchedule.update({
      where: { accountId: account.accountId },
      data: { reminderSentDate: new Date(opts.reminderSentDate + 'T00:00:00Z') },
    });
  }

  return { account, schedule };
}

// ─── Auto-close sweep ─────────────────────────────────────────────────────────

describe('runBillingLifecycle — auto-close sweep', () => {
  it('closes ACTIVE accounts where satisfied is false and due_date is more than 14 days ago', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(-15) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.closedCount).toBe(1);
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    expect(updated.status).toBe('CLOSED');
    expect(updated.closeReason).toBe('AUTO_NONPAYMENT');
  });

  it('closes SUSPENDED accounts where satisfied is false and due_date is more than 14 days ago', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(-15), status: 'SUSPENDED' });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.closedCount).toBe(1);
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    expect(updated.status).toBe('CLOSED');
  });

  it('does not close accounts where due_date is exactly 14 days ago', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(-14) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.closedCount).toBe(0);
  });

  it('does not close accounts where satisfied is true', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(-15), satisfied: true });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.closedCount).toBe(0);
  });

  it('does not close already-CLOSED accounts — auto-close idempotency FR-BILL-08', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(-15), status: 'CLOSED' });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.closedCount).toBe(0);
  });

  it('sets closeReason to AUTO_NONPAYMENT on auto-closed accounts', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(-15) });
    await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    expect(updated.closeReason).toBe('AUTO_NONPAYMENT');
  });

  it('publishes ACCOUNT_AUTO_CLOSED event via closeAccount for each auto-closed account', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(-15) });
    await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(mockSnsPublish).toHaveBeenCalledWith(
      expect.any(String),
      'ACCOUNT_AUTO_CLOSED',
      expect.objectContaining({ accountId: account.accountId }),
    );
  });
});

// ─── Reminder sweep ───────────────────────────────────────────────────────────

describe('runBillingLifecycle — reminder sweep', () => {
  it('sends reminder for ACTIVE account due within lookaheadDays and not reminded today', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(3) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(1);
    expect(mockSnsPublish).toHaveBeenCalledWith(
      expect.any(String),
      'PAYMENT_DUE_REMINDER',
      expect.objectContaining({ accountId: account.accountId }),
    );
  });

  it('sends reminder for SUSPENDED account due within lookaheadDays and not reminded today', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(3), status: 'SUSPENDED' });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(1);
    expect(mockSnsPublish).toHaveBeenCalledWith(
      expect.any(String),
      'PAYMENT_DUE_REMINDER',
      expect.objectContaining({ accountId: account.accountId }),
    );
  });

  it('does not send reminder for account already reminded today — FR-BILL-07 idempotency', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(3), reminderSentDate: todayIso() });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(0);
    expect(mockSnsPublish).not.toHaveBeenCalledWith(
      expect.any(String),
      'PAYMENT_DUE_REMINDER',
      expect.anything(),
    );
  });

  it('does not send reminder for account where satisfied is true', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(3), satisfied: true });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(0);
  });

  it('does not send reminder for account with due_date beyond lookaheadDays', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(10) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(0);
  });

  it('does not send reminder for CLOSED account', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(3), status: 'CLOSED' });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(0);
  });

  it('stamps reminderSentDate on schedule row before publishing PAYMENT_DUE_REMINDER event', async () => {
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(3) });
    await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    const schedule = await prisma.paymentDueSchedule.findUniqueOrThrow({
      where: { accountId: account.accountId },
    });
    const stampedDate = schedule.reminderSentDate?.toISOString().slice(0, 10);
    expect(stampedDate).toBe(todayIso());
  });

  it('publishes PAYMENT_DUE_REMINDER event for each reminded account', async () => {
    const { account: a1 } = await makeAccount({ paymentDueDateIso: daysFromToday(2) });
    const { account: a2 } = await makeAccount({ paymentDueDateIso: daysFromToday(5) });
    await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    const reminderCalls = mockSnsPublish.mock.calls.filter(
      (c: unknown[]) => c[1] === 'PAYMENT_DUE_REMINDER',
    );
    const remindedIds = reminderCalls.map((c: unknown[]) => (c[2] as { accountId: string }).accountId);
    expect(remindedIds).toContain(a1.accountId);
    expect(remindedIds).toContain(a2.accountId);
  });
});

// ─── Sweep ordering (FR-BILL-05) ─────────────────────────────────────────────

describe('runBillingLifecycle — sweep ordering', () => {
  it('runs auto-close sweep first — account closed in sweep 1 is not reminded in sweep 2', async () => {
    // Account is BOTH overdue for close AND within reminder window
    const { account } = await makeAccount({ paymentDueDateIso: daysFromToday(-15) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 30 });
    expect(result.closedCount).toBe(1);
    // Must NOT have been reminded — it was closed in sweep 1
    expect(result.remindedCount).toBe(0);
    expect(mockSnsPublish).not.toHaveBeenCalledWith(
      expect.any(String),
      'PAYMENT_DUE_REMINDER',
      expect.objectContaining({ accountId: account.accountId }),
    );
  });
});

// ─── Return values ────────────────────────────────────────────────────────────

describe('runBillingLifecycle — return values', () => {
  it('returns closedCount equal to number of auto-closed accounts', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(-15) });
    await makeAccount({ paymentDueDateIso: daysFromToday(-20) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.closedCount).toBe(2);
  });

  it('returns remindedCount equal to number of reminded accounts', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(3) });
    await makeAccount({ paymentDueDateIso: daysFromToday(5) });
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(2);
  });
});

// ─── Validation & idempotency ─────────────────────────────────────────────────

describe('runBillingLifecycle — validation and idempotency', () => {
  it('throws VALIDATION_ERROR when lookaheadDays is less than 1', async () => {
    await expect(
      runBillingLifecycle(prisma, clients, { lookaheadDays: 0 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('is idempotent — running twice on the same day produces no duplicate closes or reminders', async () => {
    const { account: closeAcct } = await makeAccount({ paymentDueDateIso: daysFromToday(-15) });
    const { account: remindAcct } = await makeAccount({ paymentDueDateIso: daysFromToday(3) });

    await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    const closeCount1 = mockSnsPublish.mock.calls.filter((c: unknown[]) => c[1] === 'ACCOUNT_AUTO_CLOSED').length;
    const reminderCount1 = mockSnsPublish.mock.calls.filter((c: unknown[]) => c[1] === 'PAYMENT_DUE_REMINDER').length;

    mockSnsPublish.mockClear();
    await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    const closeCount2 = mockSnsPublish.mock.calls.filter((c: unknown[]) => c[1] === 'ACCOUNT_AUTO_CLOSED').length;
    const reminderCount2 = mockSnsPublish.mock.calls.filter((c: unknown[]) => c[1] === 'PAYMENT_DUE_REMINDER').length;

    expect(closeCount1).toBe(1);
    expect(closeCount2).toBe(0); // Already CLOSED — excluded by status filter
    expect(reminderCount1).toBe(1);
    expect(reminderCount2).toBe(0); // Already reminded today — excluded by reminderSentDate filter

    void closeAcct;
    void remindAcct;
  });

  it('with lookaheadDays 1 only reminds accounts due within the next 1 day', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(1) });    // in window
    await makeAccount({ paymentDueDateIso: daysFromToday(3) });    // outside window
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 1 });
    expect(result.remindedCount).toBe(1);
  });

  it('with lookaheadDays 7 reminds accounts due within the next 7 days', async () => {
    await makeAccount({ paymentDueDateIso: daysFromToday(1) });
    await makeAccount({ paymentDueDateIso: daysFromToday(7) });
    await makeAccount({ paymentDueDateIso: daysFromToday(8) });    // outside
    const result = await runBillingLifecycle(prisma, clients, { lookaheadDays: 7 });
    expect(result.remindedCount).toBe(2);
  });
});
