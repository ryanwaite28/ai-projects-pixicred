import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { QueueConfig } from '../../local/worker.js';

// ── Mock setup ────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
const mockSend     = vi.fn();

vi.mock('../../local/../src/handlers/service/service.handler.js', () => ({
  dispatch: (...args: unknown[]) => mockDispatch(...args),
}));

vi.mock('../../local/../src/lib/logger.js', () => ({ log: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
  ReceiveMessageCommand: vi.fn().mockImplementation((input: unknown) => ({ _tag: 'Receive', input })),
  DeleteMessageCommand:  vi.fn().mockImplementation((input: unknown) => ({ _tag: 'Delete',  input })),
}));

process.env['WORKER_NO_START']             = 'true';
process.env['CREDIT_CHECK_QUEUE_URL']      = 'http://sqs.local/credit-check';
process.env['NOTIFICATION_QUEUE_URL']      = 'http://sqs.local/notification';
process.env['STATEMENT_GEN_QUEUE_URL']     = 'http://sqs.local/statement-gen';
process.env['BILLING_LIFECYCLE_QUEUE_URL'] = 'http://sqs.local/billing-lifecycle';

const APP_ID = '00000000-0000-4000-8000-000000000002';
const TXN_ID = '00000000-0000-4000-8000-000000000003';

let queues: QueueConfig[];
let pollQueue: (queue: QueueConfig) => Promise<void>;

function makeSqsMessage(body: unknown, receiptHandle = 'rh-001') {
  return { Messages: [{ Body: JSON.stringify(body), ReceiptHandle: receiptHandle, MessageId: 'msg-001' }] };
}

function makeSnsEnvelope(eventType: string, payload: unknown) {
  return { Type: 'Notification', TopicArn: 'arn:aws:sns:us-east-1:000:events', Message: JSON.stringify({ eventType, payload }) };
}

beforeAll(async () => {
  const worker = await import('../../local/worker.js');
  queues    = worker.queues;
  pollQueue = worker.pollQueue;
});

beforeEach(() => {
  mockDispatch.mockReset();
  mockSend.mockReset();
  mockDispatch.mockResolvedValue(undefined);
  mockSend.mockResolvedValue({});
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('worker queue processing', () => {
  it('processes credit-check queue message and invokes runCreditCheck', async () => {
    mockSend.mockResolvedValueOnce(makeSqsMessage({ applicationId: APP_ID }));

    await pollQueue(queues.find(q => q.name === 'credit-check')!);

    expect(mockDispatch).toHaveBeenCalledWith({
      action: 'runCreditCheck',
      payload: { applicationId: APP_ID },
    });
  });

  it('processes notification queue message and unwraps SNS envelope before routing', async () => {
    mockSend.mockResolvedValueOnce(makeSqsMessage(makeSnsEnvelope('TRANSACTION_POSTED', { transactionId: TXN_ID })));

    await pollQueue(queues.find(q => q.name === 'notification')!);

    expect(mockDispatch).toHaveBeenCalledWith({
      action: 'sendTransactionEmail',
      payload: { transactionId: TXN_ID },
    });
  });

  it('processes statement-gen queue message and invokes generateAllStatements', async () => {
    mockSend.mockResolvedValueOnce(makeSqsMessage({ period: 'monthly' }));

    await pollQueue(queues.find(q => q.name === 'statement-gen')!);

    expect(mockDispatch).toHaveBeenCalledWith({
      action: 'generateAllStatements',
      payload: { period: 'monthly' },
    });
  });

  it('processes billing-lifecycle queue message and invokes runBillingLifecycle', async () => {
    mockSend.mockResolvedValueOnce(makeSqsMessage({ lookaheadDays: 7 }));

    await pollQueue(queues.find(q => q.name === 'billing-lifecycle')!);

    expect(mockDispatch).toHaveBeenCalledWith({
      action: 'runBillingLifecycle',
      payload: { lookaheadDays: 7 },
    });
  });

  it('deletes message from queue after successful processing', async () => {
    mockSend.mockResolvedValueOnce(makeSqsMessage({ applicationId: APP_ID }));

    await pollQueue(queues.find(q => q.name === 'credit-check')!);

    // send() called twice: ReceiveMessageCommand + DeleteMessageCommand
    expect(mockSend).toHaveBeenCalledTimes(2);
    const secondCall = mockSend.mock.calls[1]![0] as { _tag: string };
    expect(secondCall._tag).toBe('Delete');
  });

  it('leaves message on queue when processing throws an error', async () => {
    mockSend.mockResolvedValueOnce(makeSqsMessage({ applicationId: APP_ID }));
    mockDispatch.mockRejectedValueOnce(new Error('processing error'));

    await pollQueue(queues.find(q => q.name === 'credit-check')!);

    // Only ReceiveMessageCommand — DeleteMessageCommand NOT called on error
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
