import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createPaymentDueSchedule,
  getPaymentDueScheduleByAccountId,
  markPaymentDueScheduleSatisfied,
  updateReminderSentDate,
  getAccountsDueForReminder,
  getAccountsOverdueForAutoClose,
} from '../../src/db/queries/payment-due-schedule.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { createApplication } from '../../src/db/queries/application.queries';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

async function seedAccount(email: string, paymentDueDate: string) {
  const app = await createApplication(prisma, {
    email,
    firstName: 'Test',
    lastName: 'User',
    dateOfBirth: '1990-01-01',
    annualIncome: 50000,
    mockSsn: '11111',
  });
  return createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: email,
    creditLimit: 5000,
    paymentDueDate,
  });
}

describe('createPaymentDueSchedule', () => {
  it('creates a schedule with satisfied=false and null dates', async () => {
    const account = await seedAccount('a@example.com', '2026-06-25');
    const schedule = await createPaymentDueSchedule(prisma, account.accountId, '2026-06-25');
    expect(schedule.accountId).toBe(account.accountId);
    expect(schedule.paymentDueDate).toBe('2026-06-25');
    expect(schedule.satisfied).toBe(false);
    expect(schedule.satisfiedAt).toBeNull();
    expect(schedule.reminderSentDate).toBeNull();
  });
});

describe('getPaymentDueScheduleByAccountId', () => {
  it('returns the schedule when it exists', async () => {
    const account = await seedAccount('b@example.com', '2026-06-25');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-25');
    const found = await getPaymentDueScheduleByAccountId(prisma, account.accountId);
    expect(found).not.toBeNull();
    expect(found!.accountId).toBe(account.accountId);
  });

  it('returns null when no schedule exists', async () => {
    const result = await getPaymentDueScheduleByAccountId(prisma, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

describe('markPaymentDueScheduleSatisfied', () => {
  it('marks satisfied and sets satisfiedAt', async () => {
    const account = await seedAccount('c@example.com', '2026-06-25');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-25');
    const updated = await markPaymentDueScheduleSatisfied(prisma, account.accountId);
    expect(updated.satisfied).toBe(true);
    expect(updated.satisfiedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — second call returns same satisfied state', async () => {
    const account = await seedAccount('d@example.com', '2026-06-25');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-25');
    const first = await markPaymentDueScheduleSatisfied(prisma, account.accountId);
    const second = await markPaymentDueScheduleSatisfied(prisma, account.accountId);
    expect(second.satisfied).toBe(true);
    expect(second.satisfiedAt!.getTime()).toBe(first.satisfiedAt!.getTime());
  });
});

describe('updateReminderSentDate', () => {
  it('sets reminderSentDate to the given date', async () => {
    const account = await seedAccount('e@example.com', '2026-06-25');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-25');
    const updated = await updateReminderSentDate(prisma, account.accountId, '2026-06-18');
    expect(updated.reminderSentDate).toBe('2026-06-18');
  });
});

describe('getAccountsDueForReminder', () => {
  it('returns accounts due within lookahead window with no prior reminder', async () => {
    const account = await seedAccount('remind@example.com', '2026-06-10');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-10');

    const results = await getAccountsDueForReminder(prisma, '2026-06-07', 5);
    expect(results.some((r) => r.accountId === account.accountId)).toBe(true);
    const row = results.find((r) => r.accountId === account.accountId)!;
    expect(row.holderEmail).toBe('remind@example.com');
    expect(typeof row.currentBalance).toBe('number');
  });

  it('excludes accounts already reminded today', async () => {
    const account = await seedAccount('reminded@example.com', '2026-06-10');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-10');
    await updateReminderSentDate(prisma, account.accountId, '2026-06-07');

    const results = await getAccountsDueForReminder(prisma, '2026-06-07', 5);
    expect(results.some((r) => r.accountId === account.accountId)).toBe(false);
  });

  it('excludes satisfied accounts', async () => {
    const account = await seedAccount('paid@example.com', '2026-06-10');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-06-10');
    await markPaymentDueScheduleSatisfied(prisma, account.accountId);

    const results = await getAccountsDueForReminder(prisma, '2026-06-07', 5);
    expect(results.some((r) => r.accountId === account.accountId)).toBe(false);
  });
});

describe('getAccountsOverdueForAutoClose', () => {
  it('returns accounts with paymentDueDate more than 14 days in the past', async () => {
    const account = await seedAccount('overdue@example.com', '2026-05-01');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-05-01');

    const results = await getAccountsOverdueForAutoClose(prisma, '2026-05-20');
    expect(results.some((r) => r.accountId === account.accountId)).toBe(true);
    const row = results.find((r) => r.accountId === account.accountId)!;
    expect(row.holderEmail).toBe('overdue@example.com');
  });

  it('excludes accounts exactly 14 days past due', async () => {
    const account = await seedAccount('borderline@example.com', '2026-05-06');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-05-06');

    // cutoffDate = today - 14 = 2026-05-06; paymentDueDate must be {lt: cutoffDate}
    const results = await getAccountsOverdueForAutoClose(prisma, '2026-05-20');
    expect(results.some((r) => r.accountId === account.accountId)).toBe(false);
  });

  it('excludes satisfied accounts', async () => {
    const account = await seedAccount('paidold@example.com', '2026-04-01');
    await createPaymentDueSchedule(prisma, account.accountId, '2026-04-01');
    await markPaymentDueScheduleSatisfied(prisma, account.accountId);

    const results = await getAccountsOverdueForAutoClose(prisma, '2026-05-20');
    expect(results.some((r) => r.accountId === account.accountId)).toBe(false);
  });
});
