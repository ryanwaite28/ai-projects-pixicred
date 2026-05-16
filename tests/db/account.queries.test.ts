import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createAccount,
  getAccountById,
  updateAccountStatus,
  updateAccountBalance,
  getActiveAccountByEmail,
} from '../../src/db/queries/account.queries';
import { createApplication } from '../../src/db/queries/application.queries';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

async function seedApplication() {
  return createApplication(prisma, {
    email: 'holder@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    dateOfBirth: '1985-06-20',
    annualIncome: 80000,
    mockSsn: '12349',
  });
}

const baseAccountInput = {
  holderEmail: 'holder@example.com',
  creditLimit: 8000,
  paymentDueDate: '2026-06-25',
  cardNumber: '1234567890123456',
  cardExpiry: new Date('2029-06-01T00:00:00Z'),
  cardCvv: '123',
};

describe('createAccount', () => {
  it('creates account with currentBalance=500 and ACTIVE status', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    expect(account.currentBalance).toBe(500);
    expect(account.status).toBe('ACTIVE');
    expect(account.creditLimit).toBe(8000);
    expect(account.availableCredit).toBe(7500);
    expect(account.holderEmail).toBe('holder@example.com');
    expect(account.paymentDueDate).toBe('2026-06-25');
    expect(account.closeReason).toBeNull();
    expect(account.closedAt).toBeNull();
  });

  it('derives availableCredit = creditLimit - currentBalance', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    expect(account.availableCredit).toBe(account.creditLimit - account.currentBalance);
  });
});

describe('getAccountById', () => {
  it('returns account when it exists', async () => {
    const app = await seedApplication();
    const created = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    const found = await getAccountById(prisma, created.accountId);
    expect(found).not.toBeNull();
    expect(found!.accountId).toBe(created.accountId);
  });

  it('returns null for unknown id', async () => {
    const result = await getAccountById(prisma, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

describe('updateAccountStatus', () => {
  it('suspends an account', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    const updated = await updateAccountStatus(prisma, account.accountId, 'SUSPENDED');
    expect(updated.status).toBe('SUSPENDED');
    expect(updated.closedAt).toBeNull();
  });

  it('closes an account with closeReason and sets closedAt', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    const updated = await updateAccountStatus(prisma, account.accountId, 'CLOSED', 'USER_REQUESTED');
    expect(updated.status).toBe('CLOSED');
    expect(updated.closeReason).toBe('USER_REQUESTED');
    expect(updated.closedAt).toBeInstanceOf(Date);
  });

  it('closes with AUTO_NONPAYMENT', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    const updated = await updateAccountStatus(prisma, account.accountId, 'CLOSED', 'AUTO_NONPAYMENT');
    expect(updated.closeReason).toBe('AUTO_NONPAYMENT');
  });
});

describe('updateAccountBalance', () => {
  it('updates currentBalance and recalculates availableCredit', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    const updated = await updateAccountBalance(prisma, account.accountId, 1200);
    expect(updated.currentBalance).toBe(1200);
    expect(updated.availableCredit).toBe(8000 - 1200);
  });
});

describe('getActiveAccountByEmail', () => {
  it('returns ACTIVE account by email', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    const found = await getActiveAccountByEmail(prisma, 'holder@example.com');
    expect(found).not.toBeNull();
    expect(found!.accountId).toBe(account.accountId);
  });

  it('returns SUSPENDED account by email', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    await updateAccountStatus(prisma, account.accountId, 'SUSPENDED');
    const found = await getActiveAccountByEmail(prisma, 'holder@example.com');
    expect(found).not.toBeNull();
  });

  it('returns null for CLOSED account', async () => {
    const app = await seedApplication();
    const account = await createAccount(prisma, { ...baseAccountInput, applicationId: app.applicationId });
    await updateAccountStatus(prisma, account.accountId, 'CLOSED', 'USER_REQUESTED');
    const found = await getActiveAccountByEmail(prisma, 'holder@example.com');
    expect(found).toBeNull();
  });

  it('returns null for unknown email', async () => {
    const found = await getActiveAccountByEmail(prisma, 'nobody@example.com');
    expect(found).toBeNull();
  });
});
