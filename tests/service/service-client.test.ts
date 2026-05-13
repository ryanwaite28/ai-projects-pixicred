import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServiceClient } from '../../src/clients/service.client';
import { PixiCredError } from '../../src/lib/errors';

const { mockLambdaSend } = vi.hoisted(() => ({
  mockLambdaSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

beforeEach(() => {
  mockLambdaSend.mockReset();
  delete process.env['ENVIRONMENT'];
  delete process.env['SERVICE_ENDPOINT'];
  delete process.env['SERVICE_LAMBDA_ARN'];
  vi.unstubAllGlobals();
});

describe('local mode', () => {
  beforeEach(() => {
    process.env['ENVIRONMENT'] = 'local';
    process.env['SERVICE_ENDPOINT'] = 'http://localhost:3001';
  });

  it('sends POST to SERVICE_ENDPOINT with serialized action body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: { accountId: 'abc' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createServiceClient();
    await client.invoke({ action: 'getAccount', payload: { accountId: 'abc' } });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'getAccount',
      payload: { accountId: 'abc' },
    });
  });

  it('returns data field from successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: { accountId: 'xyz', status: 'ACTIVE' } }),
    }));

    const client = createServiceClient();
    const result = await client.invoke({ action: 'getAccount', payload: { accountId: 'xyz' } });
    expect(result).toEqual({ accountId: 'xyz', status: 'ACTIVE' });
  });

  it('throws PixiCredError with correct code when response contains error field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'not found' } }),
    }));

    const client = createServiceClient();
    const err = await client
      .invoke({ action: 'getAccount', payload: { accountId: 'x' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('lambda mode', () => {
  beforeEach(() => {
    process.env['ENVIRONMENT'] = 'production';
    process.env['SERVICE_LAMBDA_ARN'] = 'arn:aws:lambda:us-east-1:000000000000:function:svc';
  });

  it('calls LambdaClient InvokeCommand with serialized payload', async () => {
    const responseData = { accountId: 'abc', status: 'ACTIVE' };
    mockLambdaSend.mockResolvedValueOnce({
      Payload: new TextEncoder().encode(JSON.stringify(responseData)),
    });

    const client = createServiceClient();
    await client.invoke({ action: 'getAccount', payload: { accountId: 'abc' } });

    expect(mockLambdaSend).toHaveBeenCalledOnce();
  });

  it('returns decoded result on success', async () => {
    const responseData = { accountId: 'abc123', status: 'ACTIVE' };
    mockLambdaSend.mockResolvedValueOnce({
      Payload: new TextEncoder().encode(JSON.stringify(responseData)),
    });

    const client = createServiceClient();
    const result = await client.invoke({ action: 'getAccount', payload: { accountId: 'abc123' } });
    expect(result).toEqual(responseData);
  });

  it('throws PixiCredError when FunctionError is present in response', async () => {
    const errPayload = { code: 'ACCOUNT_NOT_FOUND', message: 'not found' };
    mockLambdaSend.mockResolvedValueOnce({
      FunctionError: 'Handled',
      Payload: new TextEncoder().encode(JSON.stringify(errPayload)),
    });

    const client = createServiceClient();
    const err = await client
      .invoke({ action: 'getAccount', payload: { accountId: 'x' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('ACCOUNT_NOT_FOUND');
  });
});
