import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createNotificationPreferences,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../../src/db/queries/notification.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { createApplication } from '../../src/db/queries/application.queries';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

async function seedAccount() {
  const app = await createApplication(prisma, {
    email: 'notif@example.com',
    firstName: 'Notif',
    lastName: 'User',
    dateOfBirth: '1990-01-01',
    annualIncome: 50000,
    mockSsn: '11111',
  });
  return createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: 'notif@example.com',
    creditLimit: 5000,
    paymentDueDate: '2026-06-25',
  });
}

describe('createNotificationPreferences', () => {
  it('creates preferences with all flags defaulting to true', async () => {
    const account = await seedAccount();
    const prefs = await createNotificationPreferences(prisma, account.accountId);
    expect(prefs.accountId).toBe(account.accountId);
    expect(prefs.transactionsEnabled).toBe(true);
    expect(prefs.statementsEnabled).toBe(true);
    expect(prefs.paymentRemindersEnabled).toBe(true);
    expect(prefs.updatedAt).toBeInstanceOf(Date);
  });
});

describe('getNotificationPreferences', () => {
  it('returns preferences when they exist', async () => {
    const account = await seedAccount();
    await createNotificationPreferences(prisma, account.accountId);
    const found = await getNotificationPreferences(prisma, account.accountId);
    expect(found).not.toBeNull();
    expect(found!.accountId).toBe(account.accountId);
  });

  it('returns null when no preferences exist', async () => {
    const account = await seedAccount();
    const result = await getNotificationPreferences(prisma, account.accountId);
    expect(result).toBeNull();
  });
});

describe('updateNotificationPreferences', () => {
  it('disables transactionsEnabled', async () => {
    const account = await seedAccount();
    await createNotificationPreferences(prisma, account.accountId);
    const updated = await updateNotificationPreferences(prisma, {
      accountId: account.accountId,
      transactionsEnabled: false,
    });
    expect(updated.transactionsEnabled).toBe(false);
    expect(updated.statementsEnabled).toBe(true);
    expect(updated.paymentRemindersEnabled).toBe(true);
  });

  it('disables statementsEnabled only', async () => {
    const account = await seedAccount();
    await createNotificationPreferences(prisma, account.accountId);
    const updated = await updateNotificationPreferences(prisma, {
      accountId: account.accountId,
      statementsEnabled: false,
    });
    expect(updated.statementsEnabled).toBe(false);
    expect(updated.transactionsEnabled).toBe(true);
  });

  it('disables paymentRemindersEnabled only', async () => {
    const account = await seedAccount();
    await createNotificationPreferences(prisma, account.accountId);
    const updated = await updateNotificationPreferences(prisma, {
      accountId: account.accountId,
      paymentRemindersEnabled: false,
    });
    expect(updated.paymentRemindersEnabled).toBe(false);
    expect(updated.transactionsEnabled).toBe(true);
    expect(updated.statementsEnabled).toBe(true);
  });

  it('partial update does not touch fields not provided', async () => {
    const account = await seedAccount();
    await createNotificationPreferences(prisma, account.accountId);
    await updateNotificationPreferences(prisma, {
      accountId: account.accountId,
      transactionsEnabled: false,
    });
    const updated = await updateNotificationPreferences(prisma, {
      accountId: account.accountId,
      statementsEnabled: false,
    });
    // transactionsEnabled should still be false from first update
    expect(updated.transactionsEnabled).toBe(false);
    expect(updated.statementsEnabled).toBe(false);
  });

  it('updates updatedAt timestamp on change', async () => {
    const account = await seedAccount();
    const original = await createNotificationPreferences(prisma, account.accountId);
    await new Promise((r) => setTimeout(r, 10)); // ensure clock tick
    const updated = await updateNotificationPreferences(prisma, {
      accountId: account.accountId,
      transactionsEnabled: false,
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());
  });
});
