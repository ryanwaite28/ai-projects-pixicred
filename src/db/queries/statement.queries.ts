import { PrismaClient } from '@prisma/client';
import type { Statement, Transaction, TransactionType, TransactionStatus } from '../../types/index';

export interface CreateStatementInput {
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: number;
  closingBalance: number;
  totalCharges: number;
  totalPayments: number;
  minimumPaymentDue: number;
  dueDate: string;
}

function mapTransaction(row: {
  transactionId: string;
  accountId: string;
  type: string;
  merchantName: string | null;
  amount: { toNumber(): number };
  idempotencyKey: string;
  status: string;
  statusUpdatedAt: Date;
  notes: string | null;
  createdAt: Date;
}): Transaction {
  return {
    transactionId: row.transactionId,
    accountId: row.accountId,
    type: row.type as TransactionType,
    merchantName: row.merchantName,
    amount: row.amount.toNumber(),
    idempotencyKey: row.idempotencyKey,
    status: row.status as TransactionStatus,
    statusUpdatedAt: row.statusUpdatedAt,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
  };
}

function mapStatement(
  row: {
    statementId: string;
    accountId: string;
    periodStart: Date;
    periodEnd: Date;
    openingBalance: { toNumber(): number };
    closingBalance: { toNumber(): number };
    totalCharges: { toNumber(): number };
    totalPayments: { toNumber(): number };
    minimumPaymentDue: { toNumber(): number };
    dueDate: Date;
    generatedAt: Date;
  },
  transactions: Transaction[] = [],
): Statement {
  return {
    statementId: row.statementId,
    accountId: row.accountId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    openingBalance: row.openingBalance.toNumber(),
    closingBalance: row.closingBalance.toNumber(),
    totalCharges: row.totalCharges.toNumber(),
    totalPayments: row.totalPayments.toNumber(),
    minimumPaymentDue: row.minimumPaymentDue.toNumber(),
    dueDate: row.dueDate.toISOString().split('T')[0] as string,
    generatedAt: row.generatedAt,
    transactions,
  };
}

export async function createStatement(
  prisma: PrismaClient,
  input: CreateStatementInput,
): Promise<Statement> {
  const row = await prisma.statement.create({
    data: {
      accountId: input.accountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      openingBalance: input.openingBalance,
      closingBalance: input.closingBalance,
      totalCharges: input.totalCharges,
      totalPayments: input.totalPayments,
      minimumPaymentDue: input.minimumPaymentDue,
      dueDate: new Date(input.dueDate + 'T00:00:00Z'),
    },
  });
  return mapStatement(row);
}

export async function getStatementByPeriod(
  prisma: PrismaClient,
  accountId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<Statement | null> {
  const row = await prisma.statement.findUnique({
    where: { accountId_periodStart_periodEnd: { accountId, periodStart, periodEnd } },
  });
  return row ? mapStatement(row) : null;
}

export async function getStatementById(
  prisma: PrismaClient,
  accountId: string,
  statementId: string,
): Promise<Statement | null> {
  const row = await prisma.statement.findFirst({ where: { accountId, statementId } });
  return row ? mapStatement(row) : null;
}

export async function getStatementByIdOnly(
  prisma: PrismaClient,
  statementId: string,
): Promise<Statement | null> {
  const row = await prisma.statement.findUnique({ where: { statementId } });
  return row ? mapStatement(row) : null;
}

export async function getStatementsByAccountId(
  prisma: PrismaClient,
  accountId: string,
): Promise<Statement[]> {
  const rows = await prisma.statement.findMany({
    where: { accountId },
    orderBy: { periodEnd: 'desc' },
  });
  return rows.map((r) => mapStatement(r));
}

export async function getStatementWithTransactions(
  prisma: PrismaClient,
  accountId: string,
  statementId: string,
): Promise<Statement | null> {
  const row = await prisma.statement.findFirst({ where: { accountId, statementId } });
  if (!row) return null;

  const txRows = await prisma.transaction.findMany({
    where: {
      accountId,
      createdAt: { gte: row.periodStart, lt: row.periodEnd },
    },
    orderBy: { createdAt: 'desc' },
  });

  return mapStatement(row, txRows.map(mapTransaction));
}
