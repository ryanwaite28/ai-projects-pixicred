import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestPrisma, cleanTables } from '../db/helpers';
import { getAccount, closeAccount } from '../../src/service/account.service';
import { PixiCredError } from '../../src/lib/errors';
import {
  createApplication,
  updateApplicationStatus,
  getActiveApplicationOrAccountByEmail,
} from '../../src/db/queries/application.queries';
import { createAccount } from '../../src/db/queries/account.queries';

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

async function makeAccount(overrides: { status?: string } = {}) {
  const app = await createApplication(prisma, {
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-06-15',
    annualIncome: 75000,
    mockSsn: '12345',
  });
  // Set application to APPROVED so duplicate check doesn't block on PENDING status
  await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 7500);
  const account = await createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: app.email,
    creditLimit: 7500,
    paymentDueDate: '2026-06-25',
  });
  if (overrides.status && overrides.status !== 'ACTIVE') {
    await prisma.account.update({
      where: { accountId: account.accountId },
      data: {
        status: overrides.status,
        ...(overrides.status === 'CLOSED' ? { closeReason: 'USER_REQUESTED', closedAt: new Date() } : {}),
      },
    });
    return { ...account, status: overrides.status };
  }
  return account;
}

// ─── getAccount ───────────────────────────────────────────────────────────────

describe('getAccount', () => {
  it('returns Account with all fields for a valid accountId', async () => {
    const created = await makeAccount();
    const account = await getAccount(prisma, clients, { accountId: created.accountId });
    expect(account.accountId).toBe(created.accountId);
    expect(account.applicationId).toBeTruthy();
    expect(account.holderEmail).toBe('jane@example.com');
    expect(account.creditLimit).toBe(7500);
    expect(account.currentBalance).toBe(500);
    expect(account.status).toBe('ACTIVE');
    expect(account.paymentDueDate).toBeTruthy();
    expect(account.createdAt).toBeTruthy();
  });

  it('derives availableCredit as creditLimit minus currentBalance', async () => {
    const created = await makeAccount();
    const account = await getAccount(prisma, clients, { accountId: created.accountId });
    expect(account.availableCredit).toBe(account.creditLimit - account.currentBalance);
    expect(account.availableCredit).toBe(7000);
  });

  it('throws ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    const err = await getAccount(prisma, clients, {
      accountId: '00000000-0000-4000-8000-000000000000',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('throws VALIDATION_ERROR for non-UUID accountId', async () => {
    const err = await getAccount(prisma, clients, { accountId: 'not-a-uuid' }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });
});

// ─── closeAccount ─────────────────────────────────────────────────────────────

describe('closeAccount USER_REQUESTED', () => {
  it('transitions ACTIVE account to CLOSED', async () => {
    const created = await makeAccount();
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'USER_REQUESTED',
    });
    expect(result.status).toBe('CLOSED');
  });

  it('transitions SUSPENDED account to CLOSED', async () => {
    const created = await makeAccount({ status: 'SUSPENDED' });
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'USER_REQUESTED',
    });
    expect(result.status).toBe('CLOSED');
  });

  it('stamps closedAt on the returned Account', async () => {
    const created = await makeAccount();
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'USER_REQUESTED',
    });
    expect(result.closedAt).not.toBeNull();
    expect(result.closedAt).toBeInstanceOf(Date);
  });

  it('sets closeReason to USER_REQUESTED', async () => {
    const created = await makeAccount();
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'USER_REQUESTED',
    });
    expect(result.closeReason).toBe('USER_REQUESTED');
  });

  it('throws ACCOUNT_ALREADY_CLOSED when account is already CLOSED', async () => {
    const created = await makeAccount({ status: 'CLOSED' });
    const err = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'USER_REQUESTED',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_ALREADY_CLOSED');
  });

  it('throws ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    const err = await closeAccount(prisma, clients, {
      accountId: '00000000-0000-4000-8000-000000000000',
      reason: 'USER_REQUESTED',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('throws VALIDATION_ERROR for non-UUID accountId', async () => {
    const err = await closeAccount(prisma, clients, {
      accountId: 'not-a-uuid',
      reason: 'USER_REQUESTED',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('publishes ACCOUNT_USER_CLOSED event to SNS client', async () => {
    const created = await makeAccount();
    await closeAccount(prisma, clients, { accountId: created.accountId, reason: 'USER_REQUESTED' });
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'ACCOUNT_USER_CLOSED');
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ accountId: created.accountId });
  });

  it('does not publish ACCOUNT_AUTO_CLOSED event', async () => {
    const created = await makeAccount();
    await closeAccount(prisma, clients, { accountId: created.accountId, reason: 'USER_REQUESTED' });
    const autoCall = mockSnsPublish.mock.calls.find(([, type]) => type === 'ACCOUNT_AUTO_CLOSED');
    expect(autoCall).toBeUndefined();
  });
});

describe('closeAccount AUTO_NONPAYMENT', () => {
  it('transitions ACTIVE account to CLOSED', async () => {
    const created = await makeAccount();
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'AUTO_NONPAYMENT',
    });
    expect(result.status).toBe('CLOSED');
  });

  it('transitions SUSPENDED account to CLOSED', async () => {
    const created = await makeAccount({ status: 'SUSPENDED' });
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'AUTO_NONPAYMENT',
    });
    expect(result.status).toBe('CLOSED');
  });

  it('sets closeReason to AUTO_NONPAYMENT', async () => {
    const created = await makeAccount();
    const result = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'AUTO_NONPAYMENT',
    });
    expect(result.closeReason).toBe('AUTO_NONPAYMENT');
  });

  it('publishes ACCOUNT_AUTO_CLOSED event to SNS client', async () => {
    const created = await makeAccount();
    await closeAccount(prisma, clients, { accountId: created.accountId, reason: 'AUTO_NONPAYMENT' });
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'ACCOUNT_AUTO_CLOSED');
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ accountId: created.accountId });
  });

  it('does not publish ACCOUNT_USER_CLOSED event', async () => {
    const created = await makeAccount();
    await closeAccount(prisma, clients, { accountId: created.accountId, reason: 'AUTO_NONPAYMENT' });
    const userCall = mockSnsPublish.mock.calls.find(([, type]) => type === 'ACCOUNT_USER_CLOSED');
    expect(userCall).toBeUndefined();
  });

  it('throws ACCOUNT_ALREADY_CLOSED when account is already CLOSED', async () => {
    const created = await makeAccount({ status: 'CLOSED' });
    const err = await closeAccount(prisma, clients, {
      accountId: created.accountId,
      reason: 'AUTO_NONPAYMENT',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_ALREADY_CLOSED');
  });
});

describe('reapplication after close', () => {
  it('getActiveApplicationOrAccountByEmail returns null after account is CLOSED', async () => {
    const created = await makeAccount();
    await closeAccount(prisma, clients, { accountId: created.accountId, reason: 'USER_REQUESTED' });
    const result = await getActiveApplicationOrAccountByEmail(prisma, 'jane@example.com');
    expect(result).toBeNull();
  });
});
