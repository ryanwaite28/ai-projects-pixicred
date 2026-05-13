import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createPortalAccount,
  getPortalAccountByEmail,
  portalAccountExistsForAccountId,
} from '../../src/db/queries/auth.queries';
import { createApplication, updateApplicationStatus } from '../../src/db/queries/application.queries';
import { createAccount } from '../../src/db/queries/account.queries';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

async function makeAccount() {
  const app = await createApplication(prisma, {
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    dateOfBirth: '1990-01-01',
    annualIncome: 50000,
    mockSsn: '12345',
  });
  await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 5000);
  return createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: app.email,
    creditLimit: 5000,
    paymentDueDate: '2026-06-25',
  });
}

describe('createPortalAccount', () => {
  it('inserts row with hashed password and returns void', async () => {
    const account = await makeAccount();
    const result = await createPortalAccount(
      prisma,
      account.accountId,
      'test@example.com',
      '$2b$12$hashedpasswordvalue',
    );
    expect(result).toBeUndefined();
    const row = await prisma.portalAccount.findUnique({ where: { accountId: account.accountId } });
    expect(row).not.toBeNull();
    expect(row!.email).toBe('test@example.com');
    expect(row!.passwordHash).toBe('$2b$12$hashedpasswordvalue');
  });
});

describe('getPortalAccountByEmail', () => {
  it('returns null when email not found', async () => {
    const result = await getPortalAccountByEmail(prisma, 'nobody@example.com');
    expect(result).toBeNull();
  });

  it('returns accountId and passwordHash for matching email', async () => {
    const account = await makeAccount();
    await createPortalAccount(prisma, account.accountId, 'test@example.com', '$2b$12$hash');
    const result = await getPortalAccountByEmail(prisma, 'test@example.com');
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe(account.accountId);
    expect(result!.passwordHash).toBe('$2b$12$hash');
  });
});

describe('portalAccountExistsForAccountId', () => {
  it('returns false when no portal account exists', async () => {
    const account = await makeAccount();
    const result = await portalAccountExistsForAccountId(prisma, account.accountId);
    expect(result).toBe(false);
  });

  it('returns true when portal account exists', async () => {
    const account = await makeAccount();
    await createPortalAccount(prisma, account.accountId, 'test@example.com', '$2b$12$hash');
    const result = await portalAccountExistsForAccountId(prisma, account.accountId);
    expect(result).toBe(true);
  });
});
