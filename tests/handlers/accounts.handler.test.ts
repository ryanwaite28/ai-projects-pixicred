import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/accounts.handler';
import { PixiCredError } from '../../src/lib/errors';
import type { Account } from '../../src/types/index';
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

function makeEvent(
  method: string,
  path: string,
): APIGatewayProxyEventV2 {
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
    body: undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const activeAccount: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 500,
  availableCredit: 7000,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const closedAccount: Account = {
  ...activeAccount,
  status: 'CLOSED',
  closeReason: 'USER_REQUESTED',
  closedAt: new Date('2026-05-10T14:30:00Z'),
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('GET /accounts/:accountId', () => {
  it('returns 200 with account data including availableCredit', async () => {
    mockInvoke.mockResolvedValueOnce(activeAccount);
    const res = await handler(makeEvent('GET', '/accounts/00000000-0000-4000-8000-000000000002')) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.accountId).toBe(activeAccount.accountId);
    expect(body.data.availableCredit).toBe(7000);
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Account not found'));
    const res = await handler(makeEvent('GET', '/accounts/00000000-0000-4000-8000-000000000099')) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for non-UUID accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('VALIDATION_ERROR', 'accountId must be a valid UUID v4'));
    const res = await handler(makeEvent('GET', '/accounts/not-a-uuid')) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /accounts/:accountId', () => {
  it('returns 200 with closed account on ACTIVE account', async () => {
    mockInvoke.mockResolvedValueOnce(closedAccount);
    const res = await handler(makeEvent('DELETE', '/accounts/00000000-0000-4000-8000-000000000002')) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.status).toBe('CLOSED');
  });

  it('returns 200 with closed account on SUSPENDED account', async () => {
    mockInvoke.mockResolvedValueOnce({ ...closedAccount });
    const res = await handler(makeEvent('DELETE', '/accounts/00000000-0000-4000-8000-000000000002')) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.status).toBe('CLOSED');
  });

  it('returns 422 ACCOUNT_ALREADY_CLOSED when account is already CLOSED', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_ALREADY_CLOSED', 'Account is already closed'));
    const res = await handler(makeEvent('DELETE', '/accounts/00000000-0000-4000-8000-000000000002')) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_ALREADY_CLOSED');
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Account not found'));
    const res = await handler(makeEvent('DELETE', '/accounts/00000000-0000-4000-8000-000000000099')) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('always passes reason USER_REQUESTED to service — never AUTO_NONPAYMENT', async () => {
    mockInvoke.mockResolvedValueOnce(closedAccount);
    await handler(makeEvent('DELETE', '/accounts/00000000-0000-4000-8000-000000000002'));
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'closeAccount',
        payload: expect.objectContaining({ reason: 'USER_REQUESTED' }),
      }),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'AUTO_NONPAYMENT' }),
      }),
    );
  });
});
