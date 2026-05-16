import type { PrismaClient } from '@prisma/client';
import {
  createTransaction,
  getTransactionByIdempotencyKey,
  getTransactionsByAccountId,
  getTransactionById,
  updateTransactionStatus,
  getDisputedTransactions,
  getProcessingChargesOlderThan,
} from '../db/queries/transaction.queries.js';
import { getAccountById, getAccountByCardNumber } from '../db/queries/account.queries.js';
import { PixiCredError } from '../lib/errors.js';
import { assertUuid } from '../lib/validate.js';
import type { Transaction, TransactionStatus, ServiceClients, PostChargeInput, PostMerchantChargeInput, GetTransactionsInput } from '../types/index.js';

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

  if (input.amount > account.availableCredit) {
    const denied = await createTransaction(prisma, {
      accountId: input.accountId,
      type: 'CHARGE',
      merchantName: input.merchantName ?? undefined,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      status: 'DENIED',
    });
    const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
    await clients.snsClient.publishEvent(topicArn, 'TRANSACTION_CREATED', { transactionId: denied.transactionId });
    return denied;
  }

  // Atomic insert + balance update (FR-TXN-03)
  const [transaction] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        accountId: input.accountId,
        type: 'CHARGE',
        merchantName: input.merchantName ?? null,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        status: 'PROCESSING',
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
    status: transaction.status as TransactionStatus,
    statusUpdatedAt: transaction.statusUpdatedAt,
    notes: transaction.notes ?? null,
    createdAt: transaction.createdAt,
  };

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  await clients.snsClient.publishEvent(topicArn, 'TRANSACTION_CREATED', { transactionId: mapped.transactionId });

  return mapped;
}

export async function postMerchantCharge(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: PostMerchantChargeInput,
): Promise<Transaction> {
  assertUuid(input.idempotencyKey, 'idempotencyKey');
  if (!/^\d{16}$/.test(input.cardNumber)) throw new PixiCredError('VALIDATION_ERROR', 'cardNumber must be a 16-digit string');
  if (!/^\d{3}$/.test(input.cardCvv)) throw new PixiCredError('VALIDATION_ERROR', 'cardCvv must be a 3-digit string');
  if (!input.merchantName || !input.merchantName.trim()) throw new PixiCredError('VALIDATION_ERROR', 'merchantName is required');
  if (input.amount <= 0) throw new PixiCredError('VALIDATION_ERROR', 'amount must be positive');

  const account = await getAccountByCardNumber(prisma, input.cardNumber);
  if (!account) throw new PixiCredError('CARD_NOT_FOUND', 'No account found for the provided card number');
  if (account.cardCvv !== input.cardCvv) throw new PixiCredError('INVALID_CARD_CVV', 'Card CVV does not match');
  if (new Date(account.cardExpiry) <= new Date()) throw new PixiCredError('CARD_EXPIRED', 'Card has expired');

  return postCharge(prisma, clients, {
    accountId: account.accountId,
    merchantName: input.merchantName,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
  });
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

export async function settleTransactions(
  prisma: PrismaClient,
  clients: ServiceClients,
  _input: Record<string, never>,
): Promise<{ settled: number }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidates = await getProcessingChargesOlderThan(prisma, cutoff);
  let settled = 0;
  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  for (const tx of candidates) {
    await updateTransactionStatus(prisma, tx.transactionId, 'POSTED');
    await clients.snsClient.publishEvent(topicArn, 'TRANSACTION_POSTED', {
      transactionId: tx.transactionId,
    });
    settled++;
  }
  return { settled };
}

export async function resolveDisputes(
  prisma: PrismaClient,
  clients: ServiceClients,
  _input: Record<string, never>,
): Promise<{ resolved: number }> {
  const candidates = await getDisputedTransactions(prisma);
  let resolved = 0;
  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  for (const tx of candidates) {
    const outcome: TransactionStatus =
      Math.random() < 0.5 ? 'DISPUTE_ACCEPTED' : 'DISPUTE_DENIED';
    await updateTransactionStatus(prisma, tx.transactionId, outcome);
    await clients.snsClient.publishEvent(topicArn, 'DISPUTE_RESOLVED', {
      transactionId: tx.transactionId,
      outcome,
    });
    resolved++;
  }
  return { resolved };
}

export async function disputeTransaction(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string; transactionId: string },
): Promise<Transaction> {
  assertUuid(input.accountId, 'accountId');
  assertUuid(input.transactionId, 'transactionId');

  const tx = await getTransactionById(prisma, input.transactionId);
  if (!tx || tx.accountId !== input.accountId) {
    throw new PixiCredError('TRANSACTION_NOT_FOUND', 'Transaction not found');
  }
  if (tx.status !== 'POSTED') {
    throw new PixiCredError('TRANSACTION_NOT_DISPUTABLE', 'Only POSTED transactions can be disputed');
  }

  const updated = await updateTransactionStatus(prisma, input.transactionId, 'DISPUTED');

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  await clients.snsClient.publishEvent(topicArn, 'TRANSACTION_DISPUTED', { transactionId: input.transactionId });

  return updated;
}
