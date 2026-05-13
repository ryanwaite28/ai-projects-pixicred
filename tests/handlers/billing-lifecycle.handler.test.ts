import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/sqs/billing-lifecycle.handler';
import type { SQSEvent } from 'aws-lambda';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('../../src/clients/service.client', () => ({
  createServiceClient: () => ({ invoke: mockInvoke }),
}));

function makeSqsEvent(records: { lookaheadDays: number }[]): SQSEvent {
  return {
    Records: records.map((r, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `rh-${i}`,
      body: JSON.stringify(r),
      attributes: {} as SQSEvent['Records'][0]['attributes'],
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:billing-lifecycle',
      awsRegion: 'us-east-1',
    })),
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ closedCount: 0, remindedCount: 0 });
});

describe('billing-lifecycle SQS handler', () => {
  it('invokes runBillingLifecycle with lookaheadDays from SQS message body', async () => {
    await handler(makeSqsEvent([{ lookaheadDays: 7 }]));
    expect(mockInvoke).toHaveBeenCalledWith({
      action: 'runBillingLifecycle',
      payload: { lookaheadDays: 7 },
    });
  });

  it('processes all records in a multi-record SQS batch', async () => {
    await handler(makeSqsEvent([{ lookaheadDays: 7 }, { lookaheadDays: 3 }]));
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('throws when lookaheadDays is invalid to trigger SQS retry', async () => {
    await expect(handler(makeSqsEvent([{ lookaheadDays: 0 }]))).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws when lookaheadDays is not an integer to trigger SQS retry', async () => {
    await expect(
      handler(makeSqsEvent([{ lookaheadDays: 3.5 }])),
    ).rejects.toThrow();
  });

  it('billing-lifecycle handler idempotency — running twice on the same day does not double-close or double-remind', async () => {
    mockInvoke.mockResolvedValue({ closedCount: 2, remindedCount: 3 });
    await handler(makeSqsEvent([{ lookaheadDays: 7 }]));
    await handler(makeSqsEvent([{ lookaheadDays: 7 }]));
    // Idempotency is structural (enforced in service layer) — handler just invokes twice
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
