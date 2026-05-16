import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/payments.handler';
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
  path: string,
  body?: unknown,
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      http: { method: 'POST', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      accountId: '123456789',
      apiId: 'test',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: 'test-req',
      routeKey: `POST ${path}`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
    },
    pathParameters: {},
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const PAY_PATH = `/accounts/${ACCOUNT_ID}/payments`;
const IDEM_KEY = '00000000-0000-4000-8000-000000000004';

const paymentTxn: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000003',
  accountId: ACCOUNT_ID,
  type: 'PAYMENT',
  merchantName: null,
  amount: 100,
  idempotencyKey: IDEM_KEY,
  status: 'POSTED',
  statusUpdatedAt: new Date('2026-05-10T14:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('POST /accounts/:accountId/payments', () => {
  it('returns 201 with payment transaction on valid numeric amount', async () => {
    mockInvoke.mockResolvedValueOnce(paymentTxn);
    const res = await handler(makeEvent(PAY_PATH, { amount: 100, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.type).toBe('PAYMENT');
    expect(body.data.merchantName).toBeNull();
  });

  it('returns 201 with payment transaction when amount is "FULL"', async () => {
    mockInvoke.mockResolvedValueOnce({ ...paymentTxn, amount: 500 });
    const res = await handler(makeEvent(PAY_PATH, { amount: 'FULL', idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.amount).toBe(500);
  });

  it('returns 400 when amount is missing', async () => {
    const res = await handler(makeEvent(PAY_PATH, { idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is zero', async () => {
    const res = await handler(makeEvent(PAY_PATH, { amount: 0, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is a negative number', async () => {
    const res = await handler(makeEvent(PAY_PATH, { amount: -50, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is a non-FULL string', async () => {
    const res = await handler(makeEvent(PAY_PATH, { amount: 'half', idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when idempotencyKey is missing', async () => {
    const res = await handler(makeEvent(PAY_PATH, { amount: 100 })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent(PAY_PATH, { amount: 100, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns 422 ACCOUNT_NOT_ACTIVE for CLOSED account', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_ACTIVE', 'Account is not active'));
    const res = await handler(makeEvent(PAY_PATH, { amount: 100, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('returns 201 for SUSPENDED account — payments allowed', async () => {
    mockInvoke.mockResolvedValueOnce(paymentTxn);
    const res = await handler(makeEvent(PAY_PATH, { amount: 100, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(201);
  });

  it('returns 422 PAYMENT_EXCEEDS_BALANCE when amount exceeds balance', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('PAYMENT_EXCEEDS_BALANCE', 'Exceeds balance'));
    const res = await handler(makeEvent(PAY_PATH, { amount: 9999, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('returns 201 with original transaction on idempotent replay', async () => {
    mockInvoke.mockResolvedValueOnce(paymentTxn);
    const res = await handler(makeEvent(PAY_PATH, { amount: 100, idempotencyKey: IDEM_KEY })) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.transactionId).toBe(paymentTxn.transactionId);
  });
});
