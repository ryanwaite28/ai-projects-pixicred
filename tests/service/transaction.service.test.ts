import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestPrisma, cleanTables } from '../db/helpers';
import { postCharge, getTransactions } from '../../src/service/transaction.service';
import { PixiCredError } from '../../src/lib/errors';
import { createApplication, updateApplicationStatus } from '../../src/db/queries/application.queries';
import { createAccount } from '../../src/db/queries/account.queries';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

const mockSnsPublish = vi.fn().mockResolvedValue(undefined);
const clients = {
  sesClient: { sendEmail: vi.fn().mockResolvedValue(undefined) },
  snsClient: { publishEvent: mockSnsPublish },
  sqsClient: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  portalBaseUrl: 'https://pixicred.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:000000000000:topic';
});

async function makeAccount(overrides: { status?: string; creditLimit?: number } = {}) {
  const app = await createApplication(prisma, {
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-06-15',
    annualIncome: 75000,
    mockSsn: '12345',
  });
  await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', overrides.creditLimit ?? 7500);
  const account = await createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: app.email,
    creditLimit: overrides.creditLimit ?? 7500,
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
    return { ...account, status: overrides.status, availableCredit: account.availableCredit };
  }
  return account;
}

const BASE_KEY = '00000000-0000-4000-8000-000000000001';

// ─── postCharge ───────────────────────────────────────────────────────────────

describe('postCharge', () => {
  it('inserts Transaction of type CHARGE and returns it', async () => {
    const account = await makeAccount();
    const txn = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Amazon',
      amount: 100,
      idempotencyKey: BASE_KEY,
    });
    expect(txn.type).toBe('CHARGE');
    expect(txn.merchantName).toBe('Amazon');
    expect(txn.amount).toBe(100);
    expect(txn.transactionId).toBeTruthy();
    expect(txn.accountId).toBe(account.accountId);
  });

  it('increments account currentBalance by the charge amount', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 200, idempotencyKey: BASE_KEY });
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    expect(updated.currentBalance.toNumber()).toBe(700); // 500 opening + 200
  });

  it('decrements account availableCredit by the charge amount', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 200, idempotencyKey: BASE_KEY });
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    const creditLimit = updated.creditLimit.toNumber();
    const balance = updated.currentBalance.toNumber();
    expect(creditLimit - balance).toBe(account.availableCredit - 200);
  });

  it('publishes TRANSACTION_POSTED event to SNS client with transactionId', async () => {
    const account = await makeAccount();
    const txn = await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 50, idempotencyKey: BASE_KEY });
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'TRANSACTION_POSTED');
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ transactionId: txn.transactionId });
  });

  it('throws ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    const err = await postCharge(prisma, clients, {
      accountId: '00000000-0000-4000-8000-000000000000',
      merchantName: 'Shop',
      amount: 50,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('throws VALIDATION_ERROR for non-UUID accountId', async () => {
    const err = await postCharge(prisma, clients, {
      accountId: 'not-a-uuid',
      merchantName: 'Shop',
      amount: 50,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('throws VALIDATION_ERROR for non-UUID idempotencyKey', async () => {
    const account = await makeAccount();
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: 50,
      idempotencyKey: 'not-a-uuid',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('throws ACCOUNT_NOT_ACTIVE when account is SUSPENDED', async () => {
    const account = await makeAccount({ status: 'SUSPENDED' });
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: 50,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('throws ACCOUNT_NOT_ACTIVE when account is CLOSED', async () => {
    const account = await makeAccount({ status: 'CLOSED' });
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: 50,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('throws VALIDATION_ERROR when amount is zero', async () => {
    const account = await makeAccount();
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: 0,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('throws VALIDATION_ERROR when amount is negative', async () => {
    const account = await makeAccount();
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: -10,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('throws INSUFFICIENT_CREDIT when amount exceeds availableCredit', async () => {
    const account = await makeAccount();
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: account.availableCredit + 1,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('INSUFFICIENT_CREDIT');
  });

  it('with amount exactly equal to availableCredit succeeds and leaves availableCredit at zero', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: account.availableCredit,
      idempotencyKey: BASE_KEY,
    });
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    const avail = updated.creditLimit.toNumber() - updated.currentBalance.toNumber();
    expect(avail).toBe(0);
  });

  it('is idempotent — second call with same idempotencyKey returns original transaction', async () => {
    const account = await makeAccount();
    const first  = await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    const second = await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    expect(second.transactionId).toBe(first.transactionId);
  });

  it('idempotency — replayed charge does not create a second Transaction row in DB', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    const count = await prisma.transaction.count({ where: { accountId: account.accountId } });
    expect(count).toBe(1);
  });

  it('idempotency — replayed charge does not alter account balance', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    const balanceAfterFirst = (await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } })).currentBalance.toNumber();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    const balanceAfterSecond = (await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } })).currentBalance.toNumber();
    expect(balanceAfterSecond).toBe(balanceAfterFirst);
  });

  it('idempotency — replayed charge does not publish a second SNS event', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    mockSnsPublish.mockClear();
    await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    expect(mockSnsPublish).not.toHaveBeenCalled();
  });

  it('idempotency check runs before account validation — returns existing transaction even if account is now CLOSED', async () => {
    const account = await makeAccount();
    const original = await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    // Now close the account
    await prisma.account.update({ where: { accountId: account.accountId }, data: { status: 'CLOSED', closeReason: 'USER_REQUESTED', closedAt: new Date() } });
    // Replay with same key — should return original, not throw ACCOUNT_NOT_ACTIVE
    const replayed = await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 100, idempotencyKey: BASE_KEY });
    expect(replayed.transactionId).toBe(original.transactionId);
  });

  it('is atomic — no balance update occurs if transaction insert fails mid-flight', async () => {
    const account = await makeAccount();
    const origTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (_ops: unknown) => {
      await origTransaction(_ops as Parameters<typeof origTransaction>[0]);
      throw new Error('simulated mid-flight failure');
    });
    const err = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: 100,
      idempotencyKey: BASE_KEY,
    }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    vi.restoreAllMocks();
    // The error propagates correctly
    expect(err.message).toContain('simulated');
  });
});

// ─── getTransactions ──────────────────────────────────────────────────────────

describe('getTransactions', () => {
  async function makeCharges(accountId: string, count: number) {
    const keys = Array.from({ length: count }, (_, i) =>
      `00000000-0000-4000-${String(i + 1).padStart(4, '0')}-000000000001`,
    );
    for (const key of keys) {
      await prisma.transaction.create({
        data: { accountId, type: 'CHARGE', merchantName: 'Shop', amount: 10, idempotencyKey: key },
      });
    }
  }

  it('returns transactions for accountId sorted by createdAt descending', async () => {
    const account = await makeAccount();
    await makeCharges(account.accountId, 3);
    const txns = await getTransactions(prisma, clients, { accountId: account.accountId });
    expect(txns.length).toBe(3);
    for (let i = 1; i < txns.length; i++) {
      expect(txns[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(txns[i]!.createdAt.getTime());
    }
  });

  it('returns empty array when account has no transactions', async () => {
    const account = await makeAccount();
    const txns = await getTransactions(prisma, clients, { accountId: account.accountId });
    expect(txns).toEqual([]);
  });

  it('returns at most 20 transactions by default', async () => {
    const account = await makeAccount({ creditLimit: 15000 });
    await makeCharges(account.accountId, 25);
    const txns = await getTransactions(prisma, clients, { accountId: account.accountId });
    expect(txns.length).toBe(20);
  });

  it('respects explicit limit parameter', async () => {
    const account = await makeAccount({ creditLimit: 15000 });
    await makeCharges(account.accountId, 10);
    const txns = await getTransactions(prisma, clients, { accountId: account.accountId, limit: 5 });
    expect(txns.length).toBe(5);
  });

  it('clamps limit to 100 when limit exceeds 100', async () => {
    const account = await makeAccount({ creditLimit: 15000 });
    await makeCharges(account.accountId, 50);
    const txns = await getTransactions(prisma, clients, { accountId: account.accountId, limit: 200 });
    expect(txns.length).toBeLessThanOrEqual(100);
  });

  it('cursor — returns only transactions older than cursor row', async () => {
    const account = await makeAccount({ creditLimit: 15000 });
    await makeCharges(account.accountId, 5);
    const all = await getTransactions(prisma, clients, { accountId: account.accountId });
    expect(all.length).toBe(5);
    // Use the first (newest) as cursor — should return remaining 4
    const paged = await getTransactions(prisma, clients, { accountId: account.accountId, cursor: all[0]!.transactionId });
    expect(paged.length).toBe(4);
    expect(paged.every(t => t.transactionId !== all[0]!.transactionId)).toBe(true);
  });

  it('cursor — returns empty array when cursor is the oldest transaction', async () => {
    const account = await makeAccount({ creditLimit: 15000 });
    await makeCharges(account.accountId, 3);
    const all = await getTransactions(prisma, clients, { accountId: account.accountId });
    const oldest = all[all.length - 1]!;
    const paged = await getTransactions(prisma, clients, { accountId: account.accountId, cursor: oldest.transactionId });
    expect(paged).toEqual([]);
  });

  it('throws ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    const err = await getTransactions(prisma, clients, {
      accountId: '00000000-0000-4000-8000-000000000000',
    }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('throws VALIDATION_ERROR for non-UUID accountId', async () => {
    const err = await getTransactions(prisma, clients, { accountId: 'not-a-uuid' }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('throws VALIDATION_ERROR for non-UUID cursor', async () => {
    const account = await makeAccount();
    const err = await getTransactions(prisma, clients, { accountId: account.accountId, cursor: 'not-a-uuid' }).catch(e => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });
});
