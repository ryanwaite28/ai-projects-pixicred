import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/sqs/credit-check.handler';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('../../src/clients/service.client', () => ({
  createServiceClient: () => ({ invoke: mockInvoke }),
}));

function makeRecord(applicationId: string): SQSRecord {
  return {
    messageId: 'msg-1',
    receiptHandle: 'handle',
    body: JSON.stringify({ applicationId }),
    attributes: {} as SQSRecord['attributes'],
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:queue',
    awsRegion: 'us-east-1',
  };
}

function makeEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('credit-check handler', () => {
  it('invokes runCreditCheck for each SQS record', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await handler(makeEvent([makeRecord('aaa'), makeRecord('bbb')]));
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'runCreditCheck', payload: { applicationId: 'aaa' } });
    expect(mockInvoke).toHaveBeenCalledWith({ action: 'runCreditCheck', payload: { applicationId: 'bbb' } });
  });

  it('acknowledges message for approved SSN without throwing', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await expect(handler(makeEvent([makeRecord('00000000-0000-4000-8000-000000000001')]))).resolves.toBeUndefined();
  });

  it('acknowledges message for declined SSN without throwing', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await expect(handler(makeEvent([makeRecord('00000000-0000-4000-8000-000000000002')]))).resolves.toBeUndefined();
  });

  it('throws when serviceClient.invoke rejects — prevents SQS acknowledgement', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('service error'));
    await expect(handler(makeEvent([makeRecord('00000000-0000-4000-8000-000000000001')]))).rejects.toThrow('service error');
  });

  it('throws when applicationId is missing from SQS record body', async () => {
    const badRecord = makeRecord('');
    // Override body to have no applicationId
    badRecord.body = JSON.stringify({});
    await expect(handler(makeEvent([badRecord]))).rejects.toThrow();
  });
});
