import type { PrismaClient } from '@prisma/client';
import { getAccountById, updateAccountStatus, updateCardExpiry } from '../db/queries/account.queries.js';
import { PixiCredError } from '../lib/errors.js';
import { generateCardExpiry } from '../lib/card.js';
import { assertUuid } from '../lib/validate.js';
import type { Account, CloseReason, ServiceClients } from '../types/index.js';

export async function getAccount(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { accountId: string },
): Promise<Account> {
  assertUuid(input.accountId, 'accountId');
  const account = await getAccountById(prisma, input.accountId);
  if (!account) {
    throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);
  }
  return account;
}

export async function renewCard(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { accountId: string },
): Promise<Account> {
  assertUuid(input.accountId, 'accountId');
  const account = await getAccountById(prisma, input.accountId);
  if (!account) {
    throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);
  }
  if (account.status === 'CLOSED') {
    throw new PixiCredError('ACCOUNT_CLOSED', 'Cannot renew card on a closed account');
  }
  const newExpiry = generateCardExpiry(new Date());
  return updateCardExpiry(prisma, input.accountId, newExpiry);
}

export async function closeAccount(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string; reason: CloseReason },
): Promise<Account> {
  assertUuid(input.accountId, 'accountId');
  const account = await getAccountById(prisma, input.accountId);
  if (!account) {
    throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);
  }
  if (account.status === 'CLOSED') {
    throw new PixiCredError('ACCOUNT_ALREADY_CLOSED', 'Account is already closed');
  }

  const updated = await updateAccountStatus(prisma, input.accountId, 'CLOSED', input.reason);

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  const eventType = input.reason === 'USER_REQUESTED' ? 'ACCOUNT_USER_CLOSED' : 'ACCOUNT_AUTO_CLOSED';
  await clients.snsClient.publishEvent(topicArn, eventType, { accountId: input.accountId });

  return updated;
}
