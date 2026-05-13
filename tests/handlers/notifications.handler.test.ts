import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/notifications.handler';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

type Res = APIGatewayProxyStructuredResultV2;

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('../../src/clients/service.client', () => ({
  createServiceClient: () => ({ invoke: mockInvoke }),
}));

vi.mock('../../src/lib/config', () => ({
  getConfig: vi.fn().mockResolvedValue({ JWT_SECRET: 'test-secret', DB_HOST: 'localhost', DB_PORT: '5432', DB_NAME: 'test', DB_IAM_USER: 'test' }),
}));

vi.mock('../../src/lib/jwt', () => ({
  validateBearerToken: vi.fn(),
}));

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

function makeEvent(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      accountId: '123456789',
      apiId: 'test',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: 'test-req',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
    },
    pathParameters: {},
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const mockPrefs = {
  accountId: ACCOUNT_ID,
  transactionsEnabled: true,
  statementsEnabled: true,
  paymentRemindersEnabled: true,
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(mockPrefs);
});

describe('GET /accounts/:accountId/notifications', () => {
  it('returns 200 with all three preference fields', async () => {
    const res = await handler(makeEvent('GET', `/accounts/${ACCOUNT_ID}/notifications`)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.transactionsEnabled).toBeDefined();
    expect(body.data.statementsEnabled).toBeDefined();
    expect(body.data.paymentRemindersEnabled).toBeDefined();
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    const { PixiCredError } = await import('../../src/lib/errors.js');
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Account not found'));
    const res = await handler(makeEvent('GET', `/accounts/${ACCOUNT_ID}/notifications`)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('PATCH /accounts/:accountId/notifications', () => {
  it('returns 200 with updated preferences on valid body', async () => {
    mockInvoke.mockResolvedValueOnce({ ...mockPrefs, transactionsEnabled: false });
    const res = await handler(makeEvent('PATCH', `/accounts/${ACCOUNT_ID}/notifications`, { transactionsEnabled: false })) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.transactionsEnabled).toBe(false);
  });

  it('applies partial update — unspecified fields unchanged', async () => {
    mockInvoke.mockResolvedValueOnce({ ...mockPrefs, statementsEnabled: false });
    const res = await handler(makeEvent('PATCH', `/accounts/${ACCOUNT_ID}/notifications`, { statementsEnabled: false })) as Res;
    expect(res.statusCode).toBe(200);
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updateNotificationPreferences',
        payload: expect.objectContaining({ statementsEnabled: false }),
      }),
    );
    const payload = mockInvoke.mock.calls[0]![0].payload as Record<string, unknown>;
    expect('transactionsEnabled' in payload).toBe(false);
  });

  it('returns 400 when body contains no preference fields', async () => {
    const res = await handler(makeEvent('PATCH', `/accounts/${ACCOUNT_ID}/notifications`, { unrelatedField: 'x' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    const { PixiCredError } = await import('../../src/lib/errors.js');
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Account not found'));
    const res = await handler(makeEvent('PATCH', `/accounts/${ACCOUNT_ID}/notifications`, { transactionsEnabled: false })) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});
