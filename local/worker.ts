import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { dispatch } from '../src/handlers/service/service.handler.js';
import { log } from '../src/lib/logger.js';

const sqs = new SQSClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
  ...(process.env['AWS_ENDPOINT_URL'] ? { endpoint: process.env['AWS_ENDPOINT_URL'] } : {}),
});

interface SnsEnvelope {
  Type: string;
  TopicArn: string;
  Message: string;
}

interface SnsMessage {
  eventType: string;
  payload: Record<string, unknown>;
}

export type QueueConfig = {
  name: string;
  url: () => string;
  process: (body: string, receiptHandle: string, queueUrl: string) => Promise<void>;
};

async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
}

const queues: QueueConfig[] = [
  {
    name: 'credit-check',
    url: () => process.env['CREDIT_CHECK_QUEUE_URL'] ?? '',
    async process(body, receiptHandle, queueUrl) {
      const { applicationId } = JSON.parse(body) as { applicationId: string };
      await dispatch({ action: 'runCreditCheck', payload: { applicationId } });
      await deleteMessage(queueUrl, receiptHandle);
    },
  },
  {
    name: 'notification',
    url: () => process.env['NOTIFICATION_QUEUE_URL'] ?? '',
    async process(body, receiptHandle, queueUrl) {
      const envelope = JSON.parse(body) as SnsEnvelope;
      const message = JSON.parse(envelope.Message) as SnsMessage;
      const { eventType, payload } = message;

      if (eventType === 'APPLICATION_DECIDED') {
        const p = payload as { applicationId: string; decision: string };
        if (p.decision === 'DECLINED') {
          await dispatch({ action: 'sendDeclineEmail', payload: { applicationId: p.applicationId } });
        } else if (p.decision === 'APPROVED') {
          await dispatch({ action: 'sendApprovalEmail', payload: { applicationId: p.applicationId } });
        }
      } else if (eventType === 'TRANSACTION_POSTED') {
        const p = payload as { transactionId: string };
        await dispatch({ action: 'sendTransactionEmail', payload: { transactionId: p.transactionId } });
      } else if (eventType === 'STATEMENT_GENERATED') {
        const p = payload as { statementId: string };
        await dispatch({ action: 'sendStatementEmail', payload: { statementId: p.statementId } });
      } else if (eventType === 'PAYMENT_DUE_REMINDER') {
        const p = payload as { accountId: string };
        await dispatch({ action: 'sendPaymentDueReminderEmail', payload: { accountId: p.accountId } });
      } else if (eventType === 'ACCOUNT_AUTO_CLOSED') {
        const p = payload as { accountId: string };
        await dispatch({ action: 'sendAutoCloseEmail', payload: { accountId: p.accountId } });
      } else if (eventType === 'ACCOUNT_USER_CLOSED') {
        const p = payload as { accountId: string };
        await dispatch({ action: 'sendUserCloseEmail', payload: { accountId: p.accountId } });
      } else {
        log('warn', 'worker.notification', 0, { note: 'unknown eventType — acknowledged without action', eventType });
      }

      await deleteMessage(queueUrl, receiptHandle);
    },
  },
  {
    name: 'statement-gen',
    url: () => process.env['STATEMENT_GEN_QUEUE_URL'] ?? '',
    async process(body, receiptHandle, queueUrl) {
      const parsed = JSON.parse(body) as { period: unknown };
      if (parsed.period !== 'weekly' && parsed.period !== 'monthly') {
        throw new Error(`Invalid period: ${String(parsed.period)}`);
      }
      await dispatch({ action: 'generateAllStatements', payload: { period: parsed.period as 'weekly' | 'monthly' } });
      await deleteMessage(queueUrl, receiptHandle);
    },
  },
  {
    name: 'billing-lifecycle',
    url: () => process.env['BILLING_LIFECYCLE_QUEUE_URL'] ?? '',
    async process(body, receiptHandle, queueUrl) {
      const { lookaheadDays } = JSON.parse(body) as { lookaheadDays: number };
      await dispatch({ action: 'runBillingLifecycle', payload: { lookaheadDays } });
      await deleteMessage(queueUrl, receiptHandle);
    },
  },
  {
    name: 'dispute-resolution',
    url: () => process.env['DISPUTE_RESOLUTION_QUEUE_URL'] ?? '',
    async process(_body, receiptHandle, queueUrl) {
      await dispatch({ action: 'resolveDisputes', payload: {} });
      await deleteMessage(queueUrl, receiptHandle);
    },
  },
  {
    name: 'transaction-settlement',
    url: () => process.env['TRANSACTION_SETTLEMENT_QUEUE_URL'] ?? '',
    async process(_body, receiptHandle, queueUrl) {
      await dispatch({ action: 'settleTransactions', payload: {} });
      await deleteMessage(queueUrl, receiptHandle);
    },
  },
];

let running = true;

process.on('SIGTERM', () => {
  console.log('Worker received SIGTERM — shutting down after current poll');
  running = false;
});

export async function pollQueue(queue: QueueConfig): Promise<void> {
  const queueUrl = queue.url();
  if (!queueUrl) return;

  try {
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
      }),
    );

    for (const message of result.Messages ?? []) {
      const body = message.Body ?? '';
      const receiptHandle = message.ReceiptHandle ?? '';
      try {
        await queue.process(body, receiptHandle, queueUrl);
      } catch (e) {
        log('error', `worker.${queue.name}`, 0, { error: String(e) });
        // leave on queue on error — do not delete
      }
    }
  } catch (e) {
    log('error', `worker.${queue.name}.poll`, 0, { error: String(e) });
  }
}

export { queues };

async function run(): Promise<void> {
  console.log('Worker started — polling queues');
  while (running) {
    for (const queue of queues) {
      if (!running) break;
      await pollQueue(queue);
    }
  }
  console.log('Worker stopped');
}

// Auto-start when run directly (not imported by tests)
if (process.env['WORKER_NO_START'] !== 'true') {
  void run();
}
