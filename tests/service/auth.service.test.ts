import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { createTestPrisma, cleanTables } from '../db/helpers';
import { registerPortalAccount, loginPortalAccount } from '../../src/service/auth.service';
import { PixiCredError } from '../../src/lib/errors';
import { resetConfigForTesting } from '../../src/lib/config';
import { createApplication, updateApplicationStatus } from '../../src/db/queries/application.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { getPortalAccountByEmail } from '../../src/db/queries/auth.queries';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

const clients = {
  sesClient: { sendEmail: vi.fn().mockResolvedValue(undefined) },
  snsClient: { publishEvent: vi.fn().mockResolvedValue(undefined) },
  sqsClient: { sendMessage: vi.fn().mockResolvedValue(undefined) },
};

const JWT_SECRET = 'test-jwt-secret';

beforeEach(async () => {
  await cleanTables(prisma);
  process.env['ENVIRONMENT'] = 'local';
  process.env['JWT_SECRET'] = JWT_SECRET;
  process.env['DB_HOST'] = 'localhost';
  process.env['DB_PORT'] = '5432';
  process.env['DB_NAME'] = 'pixicred_test';
  process.env['DB_IAM_USER'] = 'pixicred_test';
  resetConfigForTesting();
  vi.clearAllMocks();
});

async function makeApprovedAccount() {
  const app = await createApplication(prisma, {
    email: 'holder@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    annualIncome: 60000,
    mockSsn: '12345',
  });
  await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 6000);
  const account = await createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: app.email,
    creditLimit: 6000,
    paymentDueDate: '2026-06-25',
  });
  return account;
}

async function makePendingAccount() {
  const app = await createApplication(prisma, {
    email: 'pending@example.com',
    firstName: 'Bob',
    lastName: 'Smith',
    dateOfBirth: '1985-05-15',
    annualIncome: 40000,
    mockSsn: '12345',
  });
  const account = await createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: app.email,
    creditLimit: 4000,
    paymentDueDate: '2026-06-25',
  });
  return account;
}

// ─── registerPortalAccount ───────────────────────────────────────────────────

describe('registerPortalAccount', () => {
  it('throws ACCOUNT_NOT_FOUND when accountId does not exist', async () => {
    await expect(
      registerPortalAccount(prisma, clients, {
        email: 'user@example.com',
        accountId: '00000000-0000-0000-0000-000000000000',
        password: 'password123',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ACCOUNT_NOT_FOUND' }));
  });

  it('throws PORTAL_ACCOUNT_NOT_ELIGIBLE when application is not APPROVED', async () => {
    const account = await makePendingAccount();
    await expect(
      registerPortalAccount(prisma, clients, {
        email: 'user@example.com',
        accountId: account.accountId,
        password: 'password123',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'PORTAL_ACCOUNT_NOT_ELIGIBLE' }));
  });

  it('throws PORTAL_ACCOUNT_EXISTS when portal account already exists for accountId', async () => {
    const account = await makeApprovedAccount();
    await registerPortalAccount(prisma, clients, {
      email: 'first@example.com',
      accountId: account.accountId,
      password: 'password123',
    });
    await expect(
      registerPortalAccount(prisma, clients, {
        email: 'second@example.com',
        accountId: account.accountId,
        password: 'password123',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'PORTAL_ACCOUNT_EXISTS' }));
  });

  it('creates portal account and returns accountId on success', async () => {
    const account = await makeApprovedAccount();
    const result = await registerPortalAccount(prisma, clients, {
      email: 'user@example.com',
      accountId: account.accountId,
      password: 'password123',
    });
    expect(result.accountId).toBe(account.accountId);
  });

  it('stores bcrypt hash — plaintext password is not stored', async () => {
    const account = await makeApprovedAccount();
    const plaintext = 'my-secret-password';
    await registerPortalAccount(prisma, clients, {
      email: 'user@example.com',
      accountId: account.accountId,
      password: plaintext,
    });
    const record = await getPortalAccountByEmail(prisma, 'user@example.com');
    expect(record).not.toBeNull();
    expect(record!.passwordHash).not.toBe(plaintext);
    expect(record!.passwordHash).toMatch(/^\$2[ab]\$/);
  });
});

// ─── loginPortalAccount ──────────────────────────────────────────────────────

describe('loginPortalAccount', () => {
  it('throws INVALID_CREDENTIALS when email not found', async () => {
    await expect(
      loginPortalAccount(prisma, clients, { email: 'nobody@example.com', password: 'password123' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
  });

  it('throws INVALID_CREDENTIALS when password does not match hash', async () => {
    const account = await makeApprovedAccount();
    await registerPortalAccount(prisma, clients, {
      email: 'user@example.com',
      accountId: account.accountId,
      password: 'correct-password',
    });
    await expect(
      loginPortalAccount(prisma, clients, { email: 'user@example.com', password: 'wrong-password' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
  });

  it('returns signed JWT with accountId and email in payload on success', async () => {
    const account = await makeApprovedAccount();
    await registerPortalAccount(prisma, clients, {
      email: 'user@example.com',
      accountId: account.accountId,
      password: 'my-password-123',
    });
    const result = await loginPortalAccount(prisma, clients, {
      email: 'user@example.com',
      password: 'my-password-123',
    });
    expect(result.token).toBeTruthy();
    expect(result.accountId).toBe(account.accountId);
    const decoded = jwt.verify(result.token, JWT_SECRET, { algorithms: ['HS256'] }) as {
      accountId: string;
      email: string;
    };
    expect(decoded.accountId).toBe(account.accountId);
    expect(decoded.email).toBe('user@example.com');
  });

  it('loginPortalAccount JWT payload contains exp approximately 24h from now', async () => {
    const account = await makeApprovedAccount();
    await registerPortalAccount(prisma, clients, {
      email: 'user@example.com',
      accountId: account.accountId,
      password: 'my-password-123',
    });
    const result = await loginPortalAccount(prisma, clients, {
      email: 'user@example.com',
      password: 'my-password-123',
    });
    const decoded = jwt.decode(result.token) as { exp: number; iat: number };
    const durationSeconds = decoded.exp - decoded.iat;
    expect(durationSeconds).toBeGreaterThanOrEqual(86390);
    expect(durationSeconds).toBeLessThanOrEqual(86410);
  });

  it('all thrown errors are PixiCredError instances', async () => {
    await expect(
      loginPortalAccount(prisma, clients, { email: 'nobody@example.com', password: 'x' }),
    ).rejects.toThrow(PixiCredError);
  });
});
