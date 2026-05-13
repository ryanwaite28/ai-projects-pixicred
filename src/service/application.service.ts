import type { PrismaClient } from '@prisma/client';
import {
  createApplication,
  getApplicationById,
  getActiveApplicationOrAccountByEmail,
  updateApplicationStatus,
} from '../db/queries/application.queries.js';
import {
  createAccount,
} from '../db/queries/account.queries.js';
import { createPaymentDueSchedule } from '../db/queries/payment-due-schedule.queries.js';
import { createNotificationPreferences } from '../db/queries/notification.queries.js';
import { PixiCredError } from '../lib/errors.js';
import { assertUuid } from '../lib/validate.js';
import type { Application, ServiceClients, SubmitApplicationInput } from '../types/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SSN_RE   = /^\d{5}$/;
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().startsWith(iso);
}

function computeCreditLimit(annualIncome: number): number {
  return Math.round(Math.min(Math.max(annualIncome * 0.10, 500), 15000));
}

function computePaymentDueDate(createdAt: Date): string {
  const month = createdAt.getUTCMonth();
  const year  = createdAt.getUTCFullYear();
  const dueMonth = month === 11 ? 0 : month + 1;
  const dueYear  = month === 11 ? year + 1 : year;
  return new Date(Date.UTC(dueYear, dueMonth, 25)).toISOString().slice(0, 10);
}

export async function submitApplication(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: SubmitApplicationInput,
): Promise<Application> {
  const { email, firstName, lastName, dateOfBirth, annualIncome, mockSsn } = input;

  if (!email || !firstName || !lastName || !dateOfBirth || !mockSsn) {
    throw new PixiCredError('VALIDATION_ERROR', 'All fields are required');
  }
  if (!EMAIL_RE.test(email)) {
    throw new PixiCredError('VALIDATION_ERROR', 'email must be a valid email address');
  }
  if (!SSN_RE.test(mockSsn)) {
    throw new PixiCredError('VALIDATION_ERROR', 'mockSsn must be exactly 5 digits');
  }
  if (typeof annualIncome !== 'number' || !isFinite(annualIncome) || annualIncome <= 0) {
    throw new PixiCredError('VALIDATION_ERROR', 'annualIncome must be a positive number');
  }
  if (!isValidCalendarDate(dateOfBirth)) {
    throw new PixiCredError('VALIDATION_ERROR', 'dateOfBirth must be a valid date in YYYY-MM-DD format');
  }

  const existing = await getActiveApplicationOrAccountByEmail(prisma, email);
  if (existing !== null) {
    throw new PixiCredError('DUPLICATE_APPLICATION', 'An active application or account already exists for this email');
  }

  const application = await createApplication(prisma, { email, firstName, lastName, dateOfBirth, annualIncome, mockSsn });

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  await clients.snsClient.publishEvent(topicArn, 'APPLICATION_SUBMITTED', { applicationId: application.applicationId });

  return application;
}

export async function getApplication(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { applicationId: string },
): Promise<Application> {
  assertUuid(input.applicationId, 'applicationId');
  const application = await getApplicationById(prisma, input.applicationId);
  if (!application) {
    throw new PixiCredError('APPLICATION_NOT_FOUND', `Application ${input.applicationId} not found`);
  }
  return application;
}

export async function runCreditCheck(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { applicationId: string },
): Promise<void> {
  assertUuid(input.applicationId, 'applicationId');
  const application = await getApplicationById(prisma, input.applicationId);
  if (!application) {
    throw new PixiCredError('APPLICATION_NOT_FOUND', `Application ${input.applicationId} not found`);
  }

  const topicArn = process.env['SNS_TOPIC_ARN'] ?? '';
  const isDeclined = application.mockSsn[0] === '5' && application.mockSsn[4] === '5';

  if (isDeclined) {
    await updateApplicationStatus(prisma, input.applicationId, 'DECLINED');
    await clients.snsClient.publishEvent(topicArn, 'APPLICATION_DECIDED', {
      applicationId: input.applicationId,
      decision: 'DECLINED',
    });
    return;
  }

  const creditLimit = computeCreditLimit(application.annualIncome);
  await updateApplicationStatus(prisma, input.applicationId, 'APPROVED', creditLimit);

  const updatedApp = await getApplicationById(prisma, input.applicationId);
  const createdAt = updatedApp?.createdAt ?? application.createdAt;
  const paymentDueDate = computePaymentDueDate(createdAt);

  let accountId: string;
  await prisma.$transaction(async (tx) => {
    const account = await createAccount(tx as PrismaClient, {
      applicationId: input.applicationId,
      holderEmail: application.email,
      creditLimit,
      paymentDueDate,
    });
    accountId = account.accountId;
    await createPaymentDueSchedule(tx as PrismaClient, account.accountId, paymentDueDate);
    await createNotificationPreferences(tx as PrismaClient, account.accountId);
  });

  await clients.snsClient.publishEvent(topicArn, 'APPLICATION_DECIDED', {
    applicationId: input.applicationId,
    decision: 'APPROVED',
    accountId: accountId!,
  });
}
