import { getPrisma } from '../../db/client.js';
import { PixiCredError } from '../../lib/errors.js';
import { log } from '../../lib/logger.js';
import { createSesClient } from '../../clients/ses.client.js';
import { createSnsClient } from '../../clients/sns.client.js';
import { createSqsClient } from '../../clients/sqs.client.js';
import { submitApplication, getApplication, runCreditCheck } from '../../service/application.service.js';
import { getAccount, closeAccount } from '../../service/account.service.js';
import { postCharge, getTransactions } from '../../service/transaction.service.js';
import { postPayment } from '../../service/payment.service.js';
import {
  generateStatement,
  generateAllStatements,
  getStatements,
  getStatement,
} from '../../service/statement.service.js';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  sendDeclineEmail,
  sendApprovalEmail,
  sendTransactionEmail,
  sendStatementEmail,
  sendPaymentDueReminderEmail,
  sendAutoCloseEmail,
  sendUserCloseEmail,
  sendApplicationSubmittedEmail,
} from '../../service/notification.service.js';
import { runBillingLifecycle } from '../../service/billing-lifecycle.service.js';
import { registerPortalAccount, loginPortalAccount } from '../../service/auth.service.js';
import type { ServiceAction, ServiceClients } from '../../types/index.js';

// Module-level singletons — constructed once per cold start
const clients: ServiceClients = {
  sesClient: createSesClient(process.env['SES_FROM_ADDRESS'] ?? ''),
  snsClient: createSnsClient(),
  sqsClient: createSqsClient(),
};

export async function dispatch(event: ServiceAction): Promise<unknown> {
  const prisma = await getPrisma();
  switch (event.action) {
    case 'submitApplication':
      return submitApplication(prisma, clients, event.payload);
    case 'getApplication':
      return getApplication(prisma, clients, event.payload);
    case 'runCreditCheck':
      return runCreditCheck(prisma, clients, event.payload);
    case 'getAccount':
      return getAccount(prisma, clients, event.payload);
    case 'closeAccount':
      return closeAccount(prisma, clients, event.payload);
    case 'postCharge':
      return postCharge(prisma, clients, event.payload);
    case 'postPayment':
      return postPayment(prisma, clients, event.payload);
    case 'getTransactions':
      return getTransactions(prisma, clients, event.payload);
    case 'generateStatement':
      return generateStatement(prisma, clients, event.payload);
    case 'generateAllStatements':
      return generateAllStatements(prisma, clients, event.payload);
    case 'getStatements':
      return getStatements(prisma, clients, event.payload);
    case 'getStatement':
      return getStatement(prisma, clients, event.payload);
    case 'getNotificationPreferences':
      return getNotificationPreferences(prisma, clients, event.payload);
    case 'updateNotificationPreferences':
      return updateNotificationPreferences(prisma, clients, event.payload);
    case 'sendDeclineEmail':
      return sendDeclineEmail(prisma, clients, event.payload);
    case 'sendApprovalEmail':
      return sendApprovalEmail(prisma, clients, event.payload);
    case 'sendTransactionEmail':
      return sendTransactionEmail(prisma, clients, event.payload);
    case 'sendStatementEmail':
      return sendStatementEmail(prisma, clients, event.payload);
    case 'sendPaymentDueReminderEmail':
      return sendPaymentDueReminderEmail(prisma, clients, event.payload);
    case 'sendAutoCloseEmail':
      return sendAutoCloseEmail(prisma, clients, event.payload);
    case 'sendUserCloseEmail':
      return sendUserCloseEmail(prisma, clients, event.payload);
    case 'sendApplicationSubmittedEmail':
      return sendApplicationSubmittedEmail(prisma, clients, event.payload);
    case 'runBillingLifecycle':
      return runBillingLifecycle(prisma, clients, event.payload);
    case 'registerPortalAccount':
      return registerPortalAccount(prisma, clients, event.payload);
    case 'loginPortalAccount':
      return loginPortalAccount(prisma, clients, event.payload);
  }
}

export const handler = async (event: ServiceAction): Promise<unknown> => {
  const start = Date.now();
  try {
    const result = await dispatch(event);
    log('info', event.action, Date.now() - start);
    return result;
  } catch (err) {
    if (err instanceof PixiCredError) {
      log('warn', event.action, Date.now() - start, { code: err.code, error: err.message });
      throw err;
    }
    log('error', event.action, Date.now() - start, { error: String(err) });
    throw new PixiCredError('INTERNAL_ERROR', 'Unexpected error');
  }
};
