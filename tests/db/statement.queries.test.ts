import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createStatement,
  getStatementByPeriod,
  getStatementById,
  getStatementsByAccountId,
  getStatementWithTransactions,
} from '../../src/db/queries/statement.queries';
import { createTransaction } from '../../src/db/queries/transaction.queries';
import { createAccount } from '../../src/db/queries/account.queries';
import { createApplication } from '../../src/db/queries/application.queries';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

async function seedAccount() {
  const app = await createApplication(prisma, {
    email: 'stmt@example.com',
    firstName: 'Stmt',
    lastName: 'User',
    dateOfBirth: '1990-01-01',
    annualIncome: 50000,
    mockSsn: '11111',
  });
  return createAccount(prisma, {
    applicationId: app.applicationId,
    holderEmail: 'stmt@example.com',
    creditLimit: 5000,
    paymentDueDate: '2026-06-25',
  });
}

const periodStart = new Date('2026-05-01T00:00:00Z');
const periodEnd = new Date('2026-05-31T23:59:59Z');

const baseStatementInput = {
  periodStart,
  periodEnd,
  openingBalance: 500,
  closingBalance: 750,
  totalCharges: 300,
  totalPayments: 50,
  minimumPaymentDue: 25,
  dueDate: '2026-06-25',
};

describe('createStatement', () => {
  it('creates a statement with empty transactions array', async () => {
    const account = await seedAccount();
    const stmt = await createStatement(prisma, { ...baseStatementInput, accountId: account.accountId });
    expect(stmt.accountId).toBe(account.accountId);
    expect(stmt.openingBalance).toBe(500);
    expect(stmt.closingBalance).toBe(750);
    expect(stmt.totalCharges).toBe(300);
    expect(stmt.totalPayments).toBe(50);
    expect(stmt.minimumPaymentDue).toBe(25);
    expect(stmt.dueDate).toBe('2026-06-25');
    expect(stmt.transactions).toEqual([]);
    expect(stmt.statementId).toBeTruthy();
    expect(stmt.generatedAt).toBeInstanceOf(Date);
  });
});

describe('getStatementByPeriod', () => {
  it('returns statement matching account and period', async () => {
    const account = await seedAccount();
    await createStatement(prisma, { ...baseStatementInput, accountId: account.accountId });
    const found = await getStatementByPeriod(prisma, account.accountId, periodStart, periodEnd);
    expect(found).not.toBeNull();
    expect(found!.accountId).toBe(account.accountId);
  });

  it('returns null for non-matching period', async () => {
    const account = await seedAccount();
    const result = await getStatementByPeriod(
      prisma,
      account.accountId,
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-04-30T23:59:59Z'),
    );
    expect(result).toBeNull();
  });
});

describe('getStatementById', () => {
  it('returns statement by id scoped to account', async () => {
    const account = await seedAccount();
    const stmt = await createStatement(prisma, { ...baseStatementInput, accountId: account.accountId });
    const found = await getStatementById(prisma, account.accountId, stmt.statementId);
    expect(found).not.toBeNull();
    expect(found!.statementId).toBe(stmt.statementId);
  });

  it('returns null for unknown statementId', async () => {
    const account = await seedAccount();
    const result = await getStatementById(prisma, account.accountId, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

describe('getStatementsByAccountId', () => {
  it('returns statements ordered by periodEnd DESC', async () => {
    const account = await seedAccount();
    await createStatement(prisma, {
      ...baseStatementInput,
      accountId: account.accountId,
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-04-30T23:59:59Z'),
      dueDate: '2026-05-25',
    });
    await createStatement(prisma, {
      ...baseStatementInput,
      accountId: account.accountId,
    });

    const stmts = await getStatementsByAccountId(prisma, account.accountId);
    expect(stmts.length).toBe(2);
    expect(stmts[0]!.periodEnd.getTime()).toBeGreaterThan(stmts[1]!.periodEnd.getTime());
  });

  it('returns empty array for account with no statements', async () => {
    const account = await seedAccount();
    const stmts = await getStatementsByAccountId(prisma, account.accountId);
    expect(stmts).toEqual([]);
  });
});

describe('getStatementWithTransactions', () => {
  it('includes transactions within the statement period', async () => {
    const account = await seedAccount();
    const stmt = await createStatement(prisma, { ...baseStatementInput, accountId: account.accountId });

    // transaction within period
    await createTransaction(prisma, {
      accountId: account.accountId,
      type: 'CHARGE',
      amount: 100,
      idempotencyKey: 'in-period',
    });

    const result = await getStatementWithTransactions(prisma, account.accountId, stmt.statementId);
    expect(result).not.toBeNull();
    expect(result!.transactions.length).toBeGreaterThanOrEqual(1);
    expect(result!.transactions.some((t) => t.idempotencyKey === 'in-period')).toBe(true);
  });

  it('returns null for unknown statementId', async () => {
    const account = await seedAccount();
    const result = await getStatementWithTransactions(prisma, account.accountId, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns empty transactions array when none in period', async () => {
    const account = await seedAccount();
    const stmt = await createStatement(prisma, {
      ...baseStatementInput,
      accountId: account.accountId,
      periodStart: new Date('2024-01-01T00:00:00Z'),
      periodEnd: new Date('2024-01-31T23:59:59Z'),
      dueDate: '2024-02-25',
    });
    const result = await getStatementWithTransactions(prisma, account.accountId, stmt.statementId);
    expect(result).not.toBeNull();
    expect(result!.transactions).toEqual([]);
  });
});
