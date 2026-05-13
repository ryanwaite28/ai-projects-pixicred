import { PrismaClient } from '@prisma/client';
import type { Transaction, TransactionType } from '../../types/index';

export interface CreateTransactionInput {
  accountId: string;
  type: TransactionType;
  merchantName?: string;
  amount: number;
  idempotencyKey: string;
}

export interface GetTransactionsInput {
  accountId: string;
  cursor?: string;
  limit?: number;
}

function mapTransaction(row: {
  transactionId: string;
  accountId: string;
  type: string;
  merchantName: string | null;
  amount: { toNumber(): number };
  idempotencyKey: string;
  createdAt: Date;
}): Transaction {
  return {
    transactionId: row.transactionId,
    accountId: row.accountId,
    type: row.type as TransactionType,
    merchantName: row.merchantName,
    amount: row.amount.toNumber(),
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

export async function createTransaction(
  prisma: PrismaClient,
  input: CreateTransactionInput,
): Promise<Transaction> {
  const row = await prisma.transaction.create({
    data: {
      accountId: input.accountId,
      type: input.type,
      merchantName: input.merchantName ?? null,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return mapTransaction(row);
}

export async function getTransactionByIdempotencyKey(
  prisma: PrismaClient,
  accountId: string,
  idempotencyKey: string,
): Promise<Transaction | null> {
  const row = await prisma.transaction.findUnique({
    where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
  });
  return row ? mapTransaction(row) : null;
}

export async function getTransactionsByAccountId(
  prisma: PrismaClient,
  input: GetTransactionsInput,
): Promise<Transaction[]> {
  const limit = input.limit ?? 20;
  const rows = await prisma.transaction.findMany({
    where: { accountId: input.accountId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(input.cursor
      ? { cursor: { transactionId: input.cursor }, skip: 1 }
      : {}),
  });
  return rows.map(mapTransaction);
}

export async function getTransactionsByAccountAndPeriod(
  prisma: PrismaClient,
  accountId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<Transaction[]> {
  const rows = await prisma.transaction.findMany({
    where: { accountId, createdAt: { gte: periodStart, lt: periodEnd } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(mapTransaction);
}

export async function getTransactionById(
  prisma: PrismaClient,
  transactionId: string,
): Promise<Transaction | null> {
  const row = await prisma.transaction.findUnique({ where: { transactionId } });
  return row ? mapTransaction(row) : null;
}
