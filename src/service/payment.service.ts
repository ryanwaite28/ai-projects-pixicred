import type { PrismaClient } from '@prisma/client';
import { getTransactionByIdempotencyKey } from '../db/queries/transaction.queries.js';
import { getAccountById } from '../db/queries/account.queries.js';
import { PixiCredError } from '../lib/errors.js';
import { assertUuid } from '../lib/validate.js';
import type { Transaction, TransactionStatus, ServiceClients, PostPaymentInput } from '../types/index.js';

export const computeMinimumPayment = (currentBalance: number): number =>
  Math.max(25, currentBalance * 0.02);

export async function postPayment(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: PostPaymentInput,
): Promise<Transaction> {
  assertUuid(input.accountId, 'accountId');
  assertUuid(input.idempotencyKey, 'idempotencyKey');

  // Idempotency check FIRST — before all domain validations (FR-PAY-04)
  const existing = await getTransactionByIdempotencyKey(prisma, input.accountId, input.idempotencyKey);
  if (existing) return existing;

  const account = await getAccountById(prisma, input.accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);
  if (account.status === 'CLOSED') throw new PixiCredError('ACCOUNT_NOT_ACTIVE', 'Account is not active');

  // Resolve amount (FR-PAY-07)
  const resolvedAmount = input.amount === 'FULL' ? account.currentBalance : input.amount;

  if (resolvedAmount <= 0) throw new PixiCredError('VALIDATION_ERROR', 'amount must be greater than zero');
  if (resolvedAmount > account.currentBalance) throw new PixiCredError('PAYMENT_EXCEEDS_BALANCE', 'Payment amount exceeds current balance');

  const newBalance = account.currentBalance - resolvedAmount;

  // Atomic: insert PAYMENT transaction + update balance + (conditionally) mark satisfied (FR-PAY-03)
  let txnRow!: {
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
  };

  await prisma.$transaction(async (tx) => {
    txnRow = await tx.transaction.create({
      data: {
        accountId: input.accountId,
        type: 'PAYMENT',
        merchantName: null,
        amount: resolvedAmount,
        idempotencyKey: input.idempotencyKey,
        status: 'POSTED',
      },
    }) as typeof txnRow;
    await tx.account.update({
      where: { accountId: input.accountId },
      data: { currentBalance: newBalance },
    });
    if (newBalance === 0) {
      await tx.paymentDueSchedule.updateMany({
        where: { accountId: input.accountId, satisfied: false },
        data: { satisfied: true, satisfiedAt: new Date() },
      });
    }
  });

  const transaction: Transaction = {
    transactionId: txnRow.transactionId,
    accountId: txnRow.accountId,
    type: 'PAYMENT',
    merchantName: null,
    amount: txnRow.amount.toNumber(),
    idempotencyKey: txnRow.idempotencyKey,
    status: txnRow.status as TransactionStatus,
    statusUpdatedAt: txnRow.statusUpdatedAt,
    notes: txnRow.notes ?? null,
    createdAt: txnRow.createdAt,
  };

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  await clients.snsClient.publishEvent(topicArn, 'TRANSACTION_POSTED', { transactionId: transaction.transactionId });

  return transaction;
}
