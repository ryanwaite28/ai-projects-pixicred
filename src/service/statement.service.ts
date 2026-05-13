import type { PrismaClient } from '@prisma/client';
import {
  createStatement,
  getStatementByPeriod,
  getStatementsByAccountId,
  getStatementWithTransactions,
} from '../db/queries/statement.queries.js';
import { getAccountById, getAccountsForStatements } from '../db/queries/account.queries.js';
import { getTransactionsByAccountAndPeriod } from '../db/queries/transaction.queries.js';
import { computeMinimumPayment } from './payment.service.js';
import { PixiCredError } from '../lib/errors.js';
import { assertUuid } from '../lib/validate.js';
import type { Statement, ServiceClients } from '../types/index.js';

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0] as string;
}

async function generateStatementForAccount(
  prisma: PrismaClient,
  clients: ServiceClients,
  accountId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<Statement> {
  // Idempotency check (FR-STMT-08)
  const existing = await getStatementByPeriod(prisma, accountId, periodStart, periodEnd);
  if (existing) return existing;

  const account = await getAccountById(prisma, accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${accountId} not found`);

  const txns = await getTransactionsByAccountAndPeriod(prisma, accountId, periodStart, periodEnd);
  const totalCharges = txns
    .filter((t) => t.type === 'CHARGE')
    .reduce((s, t) => s + t.amount, 0);
  const totalPayments = txns
    .filter((t) => t.type === 'PAYMENT')
    .reduce((s, t) => s + t.amount, 0);
  const closingBalance = account.currentBalance;
  const openingBalance = closingBalance + totalPayments - totalCharges;
  const minimumPaymentDue = computeMinimumPayment(closingBalance);
  const dueDate = toIsoDate(addDays(periodEnd, 21));

  const statement = await createStatement(prisma, {
    accountId,
    periodStart,
    periodEnd,
    openingBalance,
    closingBalance,
    totalCharges,
    totalPayments,
    minimumPaymentDue,
    dueDate,
  });

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  await clients.snsClient.publishEvent(topicArn, 'STATEMENT_GENERATED', {
    statementId: statement.statementId,
    accountId,
  });

  return statement;
}

export async function generateStatement(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string },
): Promise<Statement> {
  assertUuid(input.accountId, 'accountId');

  const account = await getAccountById(prisma, input.accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);

  const periodEnd = new Date();

  // periodStart = most recent statement's periodEnd, or account.createdAt if none
  const prior = await getStatementsByAccountId(prisma, input.accountId);
  const periodStart = prior.length > 0 ? prior[0]!.periodEnd : account.createdAt;

  return generateStatementForAccount(prisma, clients, input.accountId, periodStart, periodEnd);
}

export async function generateAllStatements(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { period: 'weekly' | 'monthly' },
): Promise<Statement[]> {
  const now = new Date();

  let periodStart: Date;
  let periodEnd: Date;

  if (input.period === 'weekly') {
    // periodEnd = start of this Monday UTC
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday));
    periodStart = addDays(periodEnd, -7);
  } else {
    // monthly: periodEnd = 1st of this month; periodStart = 1st of prior month
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const prevMonth = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
    periodStart = new Date(Date.UTC(prevYear, prevMonth, 1));
  }

  const accounts = await getAccountsForStatements(prisma);
  const statements: Statement[] = [];

  for (const account of accounts) {
    const stmt = await generateStatementForAccount(
      prisma,
      clients,
      account.accountId,
      periodStart,
      periodEnd,
    );
    statements.push(stmt);
  }

  return statements;
}

export async function getStatements(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { accountId: string },
): Promise<Statement[]> {
  assertUuid(input.accountId, 'accountId');

  const account = await getAccountById(prisma, input.accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', `Account ${input.accountId} not found`);

  return getStatementsByAccountId(prisma, input.accountId);
}

export async function getStatement(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { accountId: string; statementId: string },
): Promise<Statement> {
  assertUuid(input.accountId, 'accountId');
  assertUuid(input.statementId, 'statementId');

  const statement = await getStatementWithTransactions(prisma, input.accountId, input.statementId);
  if (!statement) throw new PixiCredError('STATEMENT_NOT_FOUND', `Statement ${input.statementId} not found`);

  return statement;
}
