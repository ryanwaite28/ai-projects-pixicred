import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/sqs/statement-gen.handler';
import type { SQSEvent } from 'aws-lambda';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('../../src/clients/service.client', () => ({
  createServiceClient: () => ({ invoke: mockInvoke }),
}));

function makeSqsEvent(records: { period: string }[]): SQSEvent {
  return {
    Records: records.map((r, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `rh-${i}`,
      body: JSON.stringify(r),
      attributes: {} as SQSEvent['Records'][0]['attributes'],
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:test-queue',
      awsRegion: 'us-east-1',
    })),
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('statement-gen SQS handler', () => {
  it('calls generateAllStatements with period weekly for weekly SQS message', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await handler(makeSqsEvent([{ period: 'weekly' }]));
    expect(mockInvoke).toHaveBeenCalledWith({
      action: 'generateAllStatements',
      payload: { period: 'weekly' },
    });
  });

  it('calls generateAllStatements with period monthly for monthly SQS message', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await handler(makeSqsEvent([{ period: 'monthly' }]));
    expect(mockInvoke).toHaveBeenCalledWith({
      action: 'generateAllStatements',
      payload: { period: 'monthly' },
    });
  });

  it('processes all records in a multi-record SQS batch', async () => {
    mockInvoke.mockResolvedValue([]);
    await handler(makeSqsEvent([{ period: 'weekly' }, { period: 'monthly' }]));
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('throws when period is invalid to trigger SQS retry', async () => {
    await expect(handler(makeSqsEvent([{ period: 'yearly' }]))).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
