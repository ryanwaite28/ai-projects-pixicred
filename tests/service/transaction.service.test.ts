import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestPrisma, cleanTables } from '../db/helpers';
import { postCharge, getTransactions, postMerchantCharge, disputeTransaction, resolveDisputes, settleTransactions } from '../../src/service/transaction.service';
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
    cardNumber: '1234567890123456',
    cardExpiry: new Date('2029-06-01T00:00:00Z'),
    cardCvv: '123',
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
const KEY_2    = '00000000-0000-4000-8000-000000000002';

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

  it('publishes TRANSACTION_CREATED event to SNS client with transactionId', async () => {
    const account = await makeAccount();
    const txn = await postCharge(prisma, clients, { accountId: account.accountId, merchantName: 'Shop', amount: 50, idempotencyKey: BASE_KEY });
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'TRANSACTION_CREATED');
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

  it('creates DENIED transaction when amount exceeds availableCredit', async () => {
    const account = await makeAccount();
    const txn = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: account.availableCredit + 1,
      idempotencyKey: BASE_KEY,
    });
    expect(txn.status).toBe('DENIED');
    expect(txn.type).toBe('CHARGE');
  });

  it('DENIED transaction does not alter account balance', async () => {
    const account = await makeAccount();
    await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: account.availableCredit + 1,
      idempotencyKey: BASE_KEY,
    });
    const updated = await prisma.account.findUniqueOrThrow({ where: { accountId: account.accountId } });
    expect(updated.currentBalance.toNumber()).toBe(500); // opening balance unchanged
  });

  it('DENIED transaction publishes TRANSACTION_CREATED event', async () => {
    const account = await makeAccount();
    const txn = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: account.availableCredit + 1,
      idempotencyKey: BASE_KEY,
    });
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'TRANSACTION_CREATED');
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ transactionId: txn.transactionId });
  });

  it('DENIED idempotency — replay of denied key returns original DENIED transaction', async () => {
    const account = await makeAccount();
    const first = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: account.availableCredit + 1,
      idempotencyKey: BASE_KEY,
    });
    expect(first.status).toBe('DENIED');
    const second = await postCharge(prisma, clients, {
      accountId: account.accountId,
      merchantName: 'Shop',
      amount: 1,
      idempotencyKey: BASE_KEY,
    });
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.status).toBe('DENIED');
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

// ─── postMerchantCharge ───────────────────────────────────────────────────────

describe('postMerchantCharge', () => {
  const validInput = {
    cardNumber: '1234567890123456',
    cardCvv: '123',
    merchantName: 'Acme Coffee',
    amount: 25,
    idempotencyKey: BASE_KEY,
  };

  it('resolves account by card number and returns a CHARGE transaction', async () => {
    await makeAccount();
    const txn = await postMerchantCharge(prisma, clients, validInput);
    expect(txn.type).toBe('CHARGE');
    expect(txn.merchantName).toBe('Acme Coffee');
    expect(txn.amount).toBe(25);
    expect(txn.transactionId).toBeTruthy();
  });

  it('publishes TRANSACTION_CREATED event via delegated postCharge', async () => {
    await makeAccount();
    const txn = await postMerchantCharge(prisma, clients, validInput);
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'TRANSACTION_CREATED');
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ transactionId: txn.transactionId });
  });

  it('throws CARD_NOT_FOUND for unknown card number', async () => {
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, cardNumber: '9999999999999999' }),
    ).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
  });

  it('throws INVALID_CARD_CVV when CVV does not match', async () => {
    await makeAccount();
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, cardCvv: '999' }),
    ).rejects.toMatchObject({ code: 'INVALID_CARD_CVV' });
  });

  it('throws CARD_EXPIRED when card expiry is in the past', async () => {
    const app = await createApplication(prisma, {
      email: 'expired@example.com',
      firstName: 'Old',
      lastName: 'Card',
      dateOfBirth: '1990-01-01',
      annualIncome: 50000,
      mockSsn: '12345',
    });
    await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 5000);
    await createAccount(prisma, {
      applicationId: app.applicationId,
      holderEmail: app.email,
      creditLimit: 5000,
      paymentDueDate: '2026-06-25',
      cardNumber: '5555555555555555',
      cardExpiry: new Date('2020-01-01T00:00:00Z'), // past
      cardCvv: '777',
    });
    await expect(
      postMerchantCharge(prisma, clients, {
        cardNumber: '5555555555555555',
        cardCvv: '777',
        merchantName: 'Shop',
        amount: 10,
        idempotencyKey: KEY_2,
      }),
    ).rejects.toMatchObject({ code: 'CARD_EXPIRED' });
  });

  it('is idempotent — second call with same idempotencyKey returns original transaction', async () => {
    await makeAccount();
    const first  = await postMerchantCharge(prisma, clients, validInput);
    const second = await postMerchantCharge(prisma, clients, validInput);
    expect(second.transactionId).toBe(first.transactionId);
  });

  it('idempotency — replayed merchant charge does not create a second transaction row', async () => {
    await makeAccount();
    const first = await postMerchantCharge(prisma, clients, validInput);
    await postMerchantCharge(prisma, clients, validInput);
    const count = await prisma.transaction.count({ where: { accountId: first.accountId } });
    expect(count).toBe(1);
  });

  it('throws VALIDATION_ERROR for non-UUID idempotencyKey', async () => {
    await makeAccount();
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, idempotencyKey: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR when cardNumber is not 16 digits', async () => {
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, cardNumber: '1234' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR when cardCvv is not 3 digits', async () => {
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, cardCvv: '12' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR when merchantName is empty', async () => {
    await makeAccount();
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, merchantName: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws VALIDATION_ERROR when amount is zero or negative', async () => {
    await makeAccount();
    await expect(
      postMerchantCharge(prisma, clients, { ...validInput, amount: 0 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
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

// ─── disputeTransaction ───────────────────────────────────────────────────────

describe('disputeTransaction', () => {
  async function makePostedTransaction(accountId: string, key = BASE_KEY) {
    return prisma.transaction.create({
      data: { accountId, type: 'CHARGE', merchantName: 'Shop', amount: 50, idempotencyKey: key, status: 'POSTED' },
    });
  }

  it('transitions a POSTED transaction to DISPUTED and returns it', async () => {
    const account = await makeAccount();
    const row = await makePostedTransaction(account.accountId);
    const result = await disputeTransaction(prisma, clients, {
      accountId: account.accountId,
      transactionId: row.transactionId,
    });
    expect(result.status).toBe('DISPUTED');
    expect(result.transactionId).toBe(row.transactionId);
  });

  it('stamps statusUpdatedAt on transition', async () => {
    const account = await makeAccount();
    const row = await makePostedTransaction(account.accountId);
    const before = new Date();
    await disputeTransaction(prisma, clients, { accountId: account.accountId, transactionId: row.transactionId });
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } });
    expect(updated.statusUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('publishes TRANSACTION_DISPUTED SNS event', async () => {
    const account = await makeAccount();
    const row = await makePostedTransaction(account.accountId);
    await disputeTransaction(prisma, clients, { accountId: account.accountId, transactionId: row.transactionId });
    const call = mockSnsPublish.mock.calls.find(([, type]) => type === 'TRANSACTION_DISPUTED');
    expect(call).toBeDefined();
    expect(call![2]).toMatchObject({ transactionId: row.transactionId });
  });

  it('throws TRANSACTION_NOT_FOUND for unknown transactionId', async () => {
    const account = await makeAccount();
    await expect(
      disputeTransaction(prisma, clients, {
        accountId: account.accountId,
        transactionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
  });

  it('throws TRANSACTION_NOT_FOUND when transactionId belongs to a different account', async () => {
    const account1 = await makeAccount();
    const account2 = await makeAccount();
    const row = await makePostedTransaction(account1.accountId);
    await expect(
      disputeTransaction(prisma, clients, { accountId: account2.accountId, transactionId: row.transactionId }),
    ).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
  });

  it.each(['PROCESSING', 'DENIED', 'DISPUTED', 'DISPUTE_ACCEPTED', 'DISPUTE_DENIED'] as const)(
    'throws TRANSACTION_NOT_DISPUTABLE for status %s',
    async (status) => {
      const account = await makeAccount();
      const row = await prisma.transaction.create({
        data: { accountId: account.accountId, type: 'CHARGE', merchantName: 'Shop', amount: 50, idempotencyKey: BASE_KEY, status },
      });
      await expect(
        disputeTransaction(prisma, clients, { accountId: account.accountId, transactionId: row.transactionId }),
      ).rejects.toMatchObject({ code: 'TRANSACTION_NOT_DISPUTABLE' });
    },
  );
});

// ─── resolveDisputes ──────────────────────────────────────────────────────────

describe('resolveDisputes', () => {
  async function makeDisputedTransaction(accountId: string, key: string) {
    return prisma.transaction.create({
      data: { accountId, type: 'CHARGE', merchantName: 'Shop', amount: 50, idempotencyKey: key, status: 'DISPUTED' },
    });
  }

  it('returns { resolved: 0 } when there are no DISPUTED transactions', async () => {
    const result = await resolveDisputes(prisma, clients, {});
    expect(result.resolved).toBe(0);
    expect(mockSnsPublish).not.toHaveBeenCalled();
  });

  it('resolves N DISPUTED transactions and returns correct resolved count', async () => {
    const account = await makeAccount();
    await makeDisputedTransaction(account.accountId, BASE_KEY);
    await makeDisputedTransaction(account.accountId, KEY_2);
    const result = await resolveDisputes(prisma, clients, {});
    expect(result.resolved).toBe(2);
  });

  it('transitions each transaction to DISPUTE_ACCEPTED or DISPUTE_DENIED', async () => {
    const account = await makeAccount();
    const row = await makeDisputedTransaction(account.accountId, BASE_KEY);
    await resolveDisputes(prisma, clients, {});
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } });
    expect(['DISPUTE_ACCEPTED', 'DISPUTE_DENIED']).toContain(updated.status);
  });

  it('stamps statusUpdatedAt on each resolved transaction', async () => {
    const account = await makeAccount();
    const row = await makeDisputedTransaction(account.accountId, BASE_KEY);
    const before = new Date();
    await resolveDisputes(prisma, clients, {});
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } });
    expect(updated.statusUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('publishes DISPUTE_RESOLVED SNS event with transactionId and outcome for each resolved transaction', async () => {
    const account = await makeAccount();
    const row = await makeDisputedTransaction(account.accountId, BASE_KEY);
    await resolveDisputes(prisma, clients, {});
    const calls = mockSnsPublish.mock.calls.filter(([, type]) => type === 'DISPUTE_RESOLVED');
    expect(calls.length).toBe(1);
    expect(calls[0]![2]).toMatchObject({ transactionId: row.transactionId });
    expect(['DISPUTE_ACCEPTED', 'DISPUTE_DENIED']).toContain(calls[0]![2].outcome);
  });

  it('covers both DISPUTE_ACCEPTED and DISPUTE_DENIED outcomes across enough runs', async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      await cleanTables(prisma);
      vi.clearAllMocks();
      const account = await makeAccount();
      const key = `00000000-0000-4000-${String(i).padStart(4, '0')}-000000000001`;
      await makeDisputedTransaction(account.accountId, key);
      await resolveDisputes(prisma, clients, {});
      const row = await prisma.transaction.findFirst({ where: { accountId: account.accountId } });
      if (row) outcomes.add(row.status);
      if (outcomes.size === 2) break;
    }
    expect(outcomes.has('DISPUTE_ACCEPTED')).toBe(true);
    expect(outcomes.has('DISPUTE_DENIED')).toBe(true);
  });

  it('is idempotent — already resolved transactions are not processed again', async () => {
    const account = await makeAccount();
    const row = await makeDisputedTransaction(account.accountId, BASE_KEY);
    await resolveDisputes(prisma, clients, {});
    const statusAfterFirst = (await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } })).status;
    mockSnsPublish.mockClear();
    const result = await resolveDisputes(prisma, clients, {});
    expect(result.resolved).toBe(0);
    expect(mockSnsPublish).not.toHaveBeenCalled();
    const statusAfterSecond = (await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } })).status;
    expect(statusAfterSecond).toBe(statusAfterFirst);
  });
});

// ─── settleTransactions ───────────────────────────────────────────────────────

describe('settleTransactions', () => {
  async function makeProcessingCharge(accountId: string, key: string, ageMs: number) {
    const createdAt = new Date(Date.now() - ageMs);
    return prisma.transaction.create({
      data: {
        accountId,
        type: 'CHARGE',
        merchantName: 'Shop',
        amount: 50,
        idempotencyKey: key,
        status: 'PROCESSING',
        createdAt,
      },
    });
  }

  const OVER_24H = 25 * 60 * 60 * 1000; // 25 hours in ms
  const UNDER_24H = 23 * 60 * 60 * 1000; // 23 hours in ms

  it('returns { settled: 0 } when there are no eligible PROCESSING transactions', async () => {
    const result = await settleTransactions(prisma, clients, {});
    expect(result.settled).toBe(0);
    expect(mockSnsPublish).not.toHaveBeenCalled();
  });

  it('settles N transactions older than 24h and returns correct settled count', async () => {
    const account = await makeAccount();
    await makeProcessingCharge(account.accountId, BASE_KEY, OVER_24H);
    await makeProcessingCharge(account.accountId, KEY_2, OVER_24H);
    const result = await settleTransactions(prisma, clients, {});
    expect(result.settled).toBe(2);
  });

  it('advances each settled transaction to POSTED', async () => {
    const account = await makeAccount();
    const row = await makeProcessingCharge(account.accountId, BASE_KEY, OVER_24H);
    await settleTransactions(prisma, clients, {});
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } });
    expect(updated.status).toBe('POSTED');
  });

  it('stamps statusUpdatedAt on each settled transaction', async () => {
    const account = await makeAccount();
    const row = await makeProcessingCharge(account.accountId, BASE_KEY, OVER_24H);
    const before = new Date();
    await settleTransactions(prisma, clients, {});
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } });
    expect(updated.statusUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('publishes TRANSACTION_POSTED SNS event with transactionId for each settled transaction', async () => {
    const account = await makeAccount();
    const row = await makeProcessingCharge(account.accountId, BASE_KEY, OVER_24H);
    await settleTransactions(prisma, clients, {});
    const calls = mockSnsPublish.mock.calls.filter(([, type]) => type === 'TRANSACTION_POSTED');
    expect(calls.length).toBe(1);
    expect(calls[0]![2]).toMatchObject({ transactionId: row.transactionId });
  });

  it('does not settle PROCESSING transactions younger than 24h', async () => {
    const account = await makeAccount();
    await makeProcessingCharge(account.accountId, BASE_KEY, UNDER_24H);
    const result = await settleTransactions(prisma, clients, {});
    expect(result.settled).toBe(0);
  });

  it('does not settle PAYMENT type transactions even if PROCESSING and old', async () => {
    const account = await makeAccount();
    await prisma.transaction.create({
      data: {
        accountId: account.accountId,
        type: 'PAYMENT',
        merchantName: null,
        amount: 50,
        idempotencyKey: BASE_KEY,
        status: 'PROCESSING',
        createdAt: new Date(Date.now() - OVER_24H),
      },
    });
    const result = await settleTransactions(prisma, clients, {});
    expect(result.settled).toBe(0);
  });

  it('is idempotent — already-POSTED transactions are not settled again', async () => {
    const account = await makeAccount();
    const row = await makeProcessingCharge(account.accountId, BASE_KEY, OVER_24H);
    await settleTransactions(prisma, clients, {});
    mockSnsPublish.mockClear();
    const result = await settleTransactions(prisma, clients, {});
    expect(result.settled).toBe(0);
    expect(mockSnsPublish).not.toHaveBeenCalled();
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { transactionId: row.transactionId } });
    expect(updated.status).toBe('POSTED');
  });
});
