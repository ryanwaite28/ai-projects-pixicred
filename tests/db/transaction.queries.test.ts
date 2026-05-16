import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createTransaction,
  getTransactionByIdempotencyKey,
  getTransactionsByAccountId,
  getTransactionById,
} from '../../src/db/queries/transaction.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { createApplication } from '../../src/db/queries/application.queries';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

async function seedAccount() {
  const app = await createApplication(prisma, {
    email: 'tx@example.com',
    firstName: 'Tx',
    lastName: 'User',
    dateOfBirth: '1990-01-01',
    annualIncome: 50000,
    mockSsn: '11111',
  });
  return createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: 'tx@example.com',
    creditLimit: 5000,
    paymentDueDate: '2026-06-25',
    cardNumber: '1234567890123456',
    cardExpiry: new Date('2029-06-01T00:00:00Z'),
    cardCvv: '123',
  });
}

describe('createTransaction', () => {
  it('creates a CHARGE transaction', async () => {
    const account = await seedAccount();
    const tx = await createTransaction(prisma, {
      accountId: account.accountId,
      type: 'CHARGE',
      merchantName: 'ACME Corp',
      amount: 150.00,
      idempotencyKey: 'key-001',
      status: 'PROCESSING',
    });
    expect(tx.type).toBe('CHARGE');
    expect(tx.merchantName).toBe('ACME Corp');
    expect(tx.amount).toBe(150);
    expect(tx.accountId).toBe(account.accountId);
    expect(tx.idempotencyKey).toBe('key-001');
    expect(tx.transactionId).toBeTruthy();
    expect(tx.createdAt).toBeInstanceOf(Date);
  });

  it('creates a PAYMENT transaction without merchantName', async () => {
    const account = await seedAccount();
    const tx = await createTransaction(prisma, {
      accountId: account.accountId,
      type: 'PAYMENT',
      amount: 200.00,
      idempotencyKey: 'key-002',
      status: 'POSTED',
    });
    expect(tx.type).toBe('PAYMENT');
    expect(tx.merchantName).toBeNull();
    expect(tx.amount).toBe(200);
  });
});

describe('getTransactionByIdempotencyKey', () => {
  it('returns transaction for matching key and account', async () => {
    const account = await seedAccount();
    await createTransaction(prisma, {
      accountId: account.accountId,
      type: 'CHARGE',
      amount: 50,
      idempotencyKey: 'idem-abc',
      status: 'PROCESSING',
    });
    const found = await getTransactionByIdempotencyKey(prisma, account.accountId, 'idem-abc');
    expect(found).not.toBeNull();
    expect(found!.idempotencyKey).toBe('idem-abc');
  });

  it('returns null for unknown key', async () => {
    const account = await seedAccount();
    const result = await getTransactionByIdempotencyKey(prisma, account.accountId, 'no-such-key');
    expect(result).toBeNull();
  });

  it('returns null for correct key but wrong account', async () => {
    const account = await seedAccount();
    await createTransaction(prisma, {
      accountId: account.accountId,
      type: 'CHARGE',
      amount: 50,
      idempotencyKey: 'idem-xyz',
      status: 'PROCESSING',
    });
    const result = await getTransactionByIdempotencyKey(prisma, 'aaaaaaaa-0000-0000-0000-000000000000', 'idem-xyz');
    expect(result).toBeNull();
  });
});

describe('getTransactionsByAccountId', () => {
  it('returns transactions ordered by createdAt DESC', async () => {
    const account = await seedAccount();
    await createTransaction(prisma, { accountId: account.accountId, type: 'CHARGE', amount: 10, idempotencyKey: 'k1', status: 'PROCESSING' });
    await createTransaction(prisma, { accountId: account.accountId, type: 'CHARGE', amount: 20, idempotencyKey: 'k2', status: 'PROCESSING' });
    await createTransaction(prisma, { accountId: account.accountId, type: 'CHARGE', amount: 30, idempotencyKey: 'k3', status: 'PROCESSING' });

    const txs = await getTransactionsByAccountId(prisma, { accountId: account.accountId });
    expect(txs.length).toBe(3);
    // most recent first
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(txs[i]!.createdAt.getTime());
    }
  });

  it('respects limit', async () => {
    const account = await seedAccount();
    for (let i = 0; i < 5; i++) {
      await createTransaction(prisma, { accountId: account.accountId, type: 'CHARGE', amount: i + 1, idempotencyKey: `lk-${i}`, status: 'PROCESSING' });
    }
    const txs = await getTransactionsByAccountId(prisma, { accountId: account.accountId, limit: 3 });
    expect(txs.length).toBe(3);
  });

  it('returns empty array for account with no transactions', async () => {
    const account = await seedAccount();
    const txs = await getTransactionsByAccountId(prisma, { accountId: account.accountId });
    expect(txs).toEqual([]);
  });

  it('cursor pagination skips the cursor item', async () => {
    const account = await seedAccount();
    for (let i = 0; i < 4; i++) {
      await createTransaction(prisma, { accountId: account.accountId, type: 'CHARGE', amount: i + 1, idempotencyKey: `pg-${i}`, status: 'PROCESSING' });
    }
    const page1 = await getTransactionsByAccountId(prisma, { accountId: account.accountId, limit: 2 });
    expect(page1.length).toBe(2);

    const page2 = await getTransactionsByAccountId(prisma, {
      accountId: account.accountId,
      limit: 2,
      cursor: page1[page1.length - 1]!.transactionId,
    });
    expect(page2.length).toBe(2);
    expect(page2[0]!.transactionId).not.toBe(page1[1]!.transactionId);
  });
});

describe('getTransactionById', () => {
  it('returns transaction by id', async () => {
    const account = await seedAccount();
    const tx = await createTransaction(prisma, {
      accountId: account.accountId,
      type: 'CHARGE',
      amount: 75,
      idempotencyKey: 'byid-key',
      status: 'PROCESSING',
    });
    const found = await getTransactionById(prisma, tx.transactionId);
    expect(found).not.toBeNull();
    expect(found!.transactionId).toBe(tx.transactionId);
  });

  it('returns null for unknown transactionId', async () => {
    const result = await getTransactionById(prisma, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
