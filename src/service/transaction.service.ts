import type { PrismaClient } from '@prisma/client';
import {
  getTransactionByIdempotencyKey,
  getTransactionsByAccountId,
} from '../db/queries/transaction.queries.js';
import { getAccountById } from '../db/queries/account.queries.js';
import { PixiCredError } from '../lib/errors.js';
import { assertUuid } from '../lib/validate.js';
import type { Transaction, ServiceClients, PostChargeInput, GetTransactionsInput } from '../types/index.js';

export async function postCharge(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: PostChargeInput,
): Promise<Transaction> {
  assertUuid(input.accountId, 'accountId');
  assertUuid(input.idempotencyKey, 'idempotencyKey');

  // Idempotency check FIRST — before all domain validations (FR-TXN-05)
  const existing = await getTransactionByIdempotencyKey(prisma, input.accountId, input.idempotencyKey);
  if (existing) return existing;

  const account = await getAccountById(prisma, input.accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);
  if (account.status !== 'ACTIVE') throw new PixiCredError('ACCOUNT_NOT_ACTIVE', 'Account is not active');
  if (input.amount <= 0) throw new PixiCredError('VALIDATION_ERROR', 'amount must be greater than zero');
  if (input.amount > account.availableCredit) throw new PixiCredError('INSUFFICIENT_CREDIT', 'Insufficient available credit');

  // Atomic insert + balance update (FR-TXN-03)
  const [transaction] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        accountId: input.accountId,
        type: 'CHARGE',
        merchantName: input.merchantName ?? null,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
      },
    }),
    prisma.account.update({
      where: { accountId: input.accountId },
      data: { currentBalance: account.currentBalance + input.amount },
    }),
  ]);

  const mapped: Transaction = {
    transactionId: transaction.transactionId,
    accountId: transaction.accountId,
    type: transaction.type as 'CHARGE',
    merchantName: transaction.merchantName,
    amount: (transaction.amount as { toNumber(): number }).toNumber(),
    idempotencyKey: transaction.idempotencyKey,
    createdAt: transaction.createdAt,
  };

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  await clients.snsClient.publishEvent(topicArn, 'TRANSACTION_POSTED', { transactionId: mapped.transactionId });

  return mapped;
}

export async function getTransactions(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: GetTransactionsInput,
): Promise<Transaction[]> {
  assertUuid(input.accountId, 'accountId');
  if (input.cursor) assertUuid(input.cursor, 'cursor');

  const limit = input.limit !== undefined ? Math.min(input.limit, 100) : 20;

  const account = await getAccountById(prisma, input.accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);

  return getTransactionsByAccountId(prisma, { accountId: input.accountId, cursor: input.cursor, limit });
}
