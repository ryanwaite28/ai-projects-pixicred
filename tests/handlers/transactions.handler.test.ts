import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/transactions.handler';
import { PixiCredError } from '../../src/lib/errors';
import type { Transaction } from '../../src/types/index';
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
  body?: unknown,
  qs: Record<string, string> = {},
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
    queryStringParameters: Object.keys(qs).length > 0 ? qs : undefined,
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const TXN_PATH = `/accounts/${ACCOUNT_ID}/transactions`;

const txn: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000003',
  accountId: ACCOUNT_ID,
  type: 'CHARGE',
  merchantName: 'Amazon',
  amount: 100,
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
  status: 'PROCESSING',
  statusUpdatedAt: new Date('2026-05-10T14:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('POST /accounts/:accountId/transactions', () => {
  const validBody = {
    merchantName: 'Amazon',
    amount: 100,
    idempotencyKey: '00000000-0000-4000-8000-000000000004',
  };

  it('returns 201 with transaction on valid input', async () => {
    mockInvoke.mockResolvedValueOnce(txn);
    const res = await handler(makeEvent('POST', TXN_PATH, validBody)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.type).toBe('CHARGE');
    expect(body.data.merchantName).toBe('Amazon');
  });

  it('returns 400 when merchantName is missing', async () => {
    const res = await handler(makeEvent('POST', TXN_PATH, { ...validBody, merchantName: '' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is not a number', async () => {
    const res = await handler(makeEvent('POST', TXN_PATH, { ...validBody, amount: 'notanumber' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when idempotencyKey is missing', async () => {
    const res = await handler(makeEvent('POST', TXN_PATH, { ...validBody, idempotencyKey: '' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent('POST', TXN_PATH, validBody)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns 422 ACCOUNT_NOT_ACTIVE for non-active account', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_ACTIVE', 'Account is not active'));
    const res = await handler(makeEvent('POST', TXN_PATH, validBody)) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('returns 201 with DENIED transaction when amount exceeds available credit', async () => {
    const deniedTxn = { ...txn, status: 'DENIED' };
    mockInvoke.mockResolvedValueOnce(deniedTxn);
    const res = await handler(makeEvent('POST', TXN_PATH, validBody)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.status).toBe('DENIED');
  });

  it('returns 201 with original transaction on idempotent replay', async () => {
    mockInvoke.mockResolvedValueOnce(txn);
    const res = await handler(makeEvent('POST', TXN_PATH, validBody)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.transactionId).toBe(txn.transactionId);
  });
});

describe('POST /accounts/:accountId/transactions/:transactionId/dispute', () => {
  const TXN_ID = '00000000-0000-4000-8000-000000000003';
  const DISPUTE_PATH = `/accounts/${ACCOUNT_ID}/transactions/${TXN_ID}/dispute`;
  const disputedTxn = { ...txn, status: 'DISPUTED' };

  it('returns 200 with disputed transaction on success', async () => {
    mockInvoke.mockResolvedValueOnce(disputedTxn);
    const res = await handler(makeEvent('POST', DISPUTE_PATH)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.status).toBe('DISPUTED');
  });

  it('invokes disputeTransaction with accountId and transactionId', async () => {
    mockInvoke.mockResolvedValueOnce(disputedTxn);
    await handler(makeEvent('POST', DISPUTE_PATH));
    expect(mockInvoke).toHaveBeenCalledWith({
      action: 'disputeTransaction',
      payload: { accountId: ACCOUNT_ID, transactionId: TXN_ID },
    });
  });

  it('returns 404 TRANSACTION_NOT_FOUND for unknown transaction', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('TRANSACTION_NOT_FOUND', 'not found'));
    const res = await handler(makeEvent('POST', DISPUTE_PATH)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('returns 422 TRANSACTION_NOT_DISPUTABLE for non-POSTED transaction', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('TRANSACTION_NOT_DISPUTABLE', 'not disputable'));
    const res = await handler(makeEvent('POST', DISPUTE_PATH)) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('TRANSACTION_NOT_DISPUTABLE');
  });
});

describe('GET /accounts/:accountId/transactions', () => {
  it('returns 200 with transactions array', async () => {
    mockInvoke.mockResolvedValueOnce([txn]);
    const res = await handler(makeEvent('GET', TXN_PATH)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
  });

  it('returns 200 with empty array when no transactions', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const res = await handler(makeEvent('GET', TXN_PATH)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data).toEqual([]);
  });

  it('passes cursor query param to service', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const cursorId = '00000000-0000-4000-8000-000000000099';
    await handler(makeEvent('GET', TXN_PATH, undefined, { cursor: cursorId }));
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ cursor: cursorId }),
      }),
    );
  });

  it('passes limit query param to service as integer', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await handler(makeEvent('GET', TXN_PATH, undefined, { limit: '5' }));
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ limit: 5 }),
      }),
    );
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent('GET', TXN_PATH)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});
