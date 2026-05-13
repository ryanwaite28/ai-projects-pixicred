import type { SQSEvent } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { log } from '../../lib/logger.js';

const serviceClient = createServiceClient();

interface SnsEnvelope {
  Type: string;
  TopicArn: string;
  Message: string;
}

interface SnsMessage {
  eventType: string;
  payload: Record<string, unknown>;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const envelope = JSON.parse(record.body) as SnsEnvelope;
    const message = JSON.parse(envelope.Message) as SnsMessage;
    const { eventType, payload } = message;

    if (eventType === 'APPLICATION_DECIDED') {
      const p = payload as { applicationId: string; decision: string };
      if (p.decision === 'DECLINED') {
        await serviceClient.invoke({ action: 'sendDeclineEmail', payload: { applicationId: p.applicationId } });
      } else if (p.decision === 'APPROVED') {
        await serviceClient.invoke({ action: 'sendApprovalEmail', payload: { applicationId: p.applicationId } });
      }
    } else if (eventType === 'TRANSACTION_POSTED') {
      const p = payload as { transactionId: string };
      await serviceClient.invoke({ action: 'sendTransactionEmail', payload: { transactionId: p.transactionId } });
    } else if (eventType === 'STATEMENT_GENERATED') {
      const p = payload as { statementId: string };
      await serviceClient.invoke({ action: 'sendStatementEmail', payload: { statementId: p.statementId } });
    } else if (eventType === 'PAYMENT_DUE_REMINDER') {
      const p = payload as { accountId: string };
      await serviceClient.invoke({ action: 'sendPaymentDueReminderEmail', payload: { accountId: p.accountId } });
    } else if (eventType === 'ACCOUNT_AUTO_CLOSED') {
      const p = payload as { accountId: string };
      await serviceClient.invoke({ action: 'sendAutoCloseEmail', payload: { accountId: p.accountId } });
    } else if (eventType === 'ACCOUNT_USER_CLOSED') {
      const p = payload as { accountId: string };
      await serviceClient.invoke({ action: 'sendUserCloseEmail', payload: { accountId: p.accountId } });
    } else {
      log('warn', 'notification.handler', 0, { note: 'unknown eventType — acknowledged without action', eventType });
    }
  }
};
