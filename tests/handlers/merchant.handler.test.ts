import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/merchant.handler';
import { PixiCredError } from '../../src/lib/errors';
import type { Transaction } from '../../src/types/index';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

type Res = APIGatewayProxyStructuredResultV2;

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('../../src/clients/service.client', () => ({
  createServiceClient: () => ({ invoke: mockInvoke }),
}));

function makeEvent(
  method: string,
  path: string,
  body?: Record<string, unknown>,
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
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const validBody = {
  cardNumber: '1234567890123456',
  cardCvv: '123',
  merchantName: 'Acme Coffee',
  amount: 25,
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
};

const mockTransaction: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000010',
  accountId: '00000000-0000-4000-8000-000000000002',
  type: 'CHARGE',
  merchantName: 'Acme Coffee',
  amount: 25,
  idempotencyKey: validBody.idempotencyKey,
  status: 'PROCESSING',
  statusUpdatedAt: new Date('2026-05-15T00:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-15T00:00:00Z'),
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('POST /merchant/charge', () => {
  it('returns 201 with transaction data on success', async () => {
    mockInvoke.mockResolvedValueOnce(mockTransaction);
    const res = await handler(makeEvent('POST', '/merchant/charge', validBody)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.transactionId).toBe(mockTransaction.transactionId);
    expect(body.data.amount).toBe(25);
  });

  it('invokes postMerchantCharge action with all fields', async () => {
    mockInvoke.mockResolvedValueOnce(mockTransaction);
    await handler(makeEvent('POST', '/merchant/charge', validBody));
    expect(mockInvoke).toHaveBeenCalledWith({
      action: 'postMerchantCharge',
      payload: {
        cardNumber: validBody.cardNumber,
        cardCvv: validBody.cardCvv,
        merchantName: validBody.merchantName,
        amount: validBody.amount,
        idempotencyKey: validBody.idempotencyKey,
      },
    });
  });

  it('requires no Authorization header — no JWT validation', async () => {
    mockInvoke.mockResolvedValueOnce(mockTransaction);
    const event = makeEvent('POST', '/merchant/charge', validBody);
    delete (event.headers as Record<string, string>)['authorization'];
    const res = await handler(event) as Res;
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
    const res = await handler(makeEvent('POST', '/merchant/charge', { cardNumber: '1234567890123456' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when amount is not a positive number', async () => {
    const res = await handler(makeEvent('POST', '/merchant/charge', { ...validBody, amount: -5 })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 CARD_NOT_FOUND for unknown card', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('CARD_NOT_FOUND', 'No account found for the provided card number'));
    const res = await handler(makeEvent('POST', '/merchant/charge', validBody)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('CARD_NOT_FOUND');
  });

  it('returns 422 INVALID_CARD_CVV when CVV does not match', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('INVALID_CARD_CVV', 'Card CVV does not match'));
    const res = await handler(makeEvent('POST', '/merchant/charge', validBody)) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('INVALID_CARD_CVV');
  });

  it('returns 422 CARD_EXPIRED when card has expired', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('CARD_EXPIRED', 'Card has expired'));
    const res = await handler(makeEvent('POST', '/merchant/charge', validBody)) as Res;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('CARD_EXPIRED');
  });

  it('returns 201 with DENIED transaction when charge exceeds available credit', async () => {
    const deniedTxn = { ...mockTransaction, status: 'DENIED' };
    mockInvoke.mockResolvedValueOnce(deniedTxn);
    const res = await handler(makeEvent('POST', '/merchant/charge', validBody)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.status).toBe('DENIED');
  });

  it('returns 404 for unknown route', async () => {
    const res = await handler(makeEvent('GET', '/merchant/charge')) as Res;
    expect(res.statusCode).toBe(404);
  });
});
