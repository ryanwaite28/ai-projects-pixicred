import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/statements.handler';
import { PixiCredError } from '../../src/lib/errors';
import type { Statement } from '../../src/types/index';
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

function makeEvent(method: string, path: string): APIGatewayProxyEventV2 {
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

const ACCOUNT_ID   = '00000000-0000-4000-8000-000000000002';
const STATEMENT_ID = '00000000-0000-4000-8000-000000000010';
const LIST_PATH    = `/accounts/${ACCOUNT_ID}/statements`;
const GET_PATH     = `/accounts/${ACCOUNT_ID}/statements/${STATEMENT_ID}`;

const stmt: Statement = {
  statementId: STATEMENT_ID,
  accountId: ACCOUNT_ID,
  periodStart: new Date('2026-05-01T00:00:00Z'),
  periodEnd: new Date('2026-06-01T00:00:00Z'),
  openingBalance: 500,
  closingBalance: 650,
  totalCharges: 250,
  totalPayments: 100,
  minimumPaymentDue: 25,
  dueDate: '2026-06-22',
  generatedAt: new Date('2026-06-01T00:05:00Z'),
  transactions: [],
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('POST /accounts/:accountId/statements', () => {
  it('returns 201 with generated statement', async () => {
    mockInvoke.mockResolvedValueOnce(stmt);
    const res = await handler(makeEvent('POST', LIST_PATH)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.statementId).toBe(STATEMENT_ID);
  });

  it('returns 201 with existing statement on idempotent replay', async () => {
    mockInvoke.mockResolvedValueOnce(stmt);
    const res = await handler(makeEvent('POST', LIST_PATH)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.statementId).toBe(STATEMENT_ID);
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent('POST', LIST_PATH)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('GET /accounts/:accountId/statements', () => {
  it('returns 200 with statements array sorted by periodEnd descending', async () => {
    const older = { ...stmt, statementId: '00000000-0000-4000-8000-000000000011', periodEnd: new Date('2026-05-01T00:00:00Z') };
    mockInvoke.mockResolvedValueOnce([stmt, older]);
    const res = await handler(makeEvent('GET', LIST_PATH)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
  });

  it('returns 200 with empty array when no statements exist', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const res = await handler(makeEvent('GET', LIST_PATH)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data).toEqual([]);
  });

  it('returns 404 ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('ACCOUNT_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent('GET', LIST_PATH)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('GET /accounts/:accountId/statements/:statementId', () => {
  it('returns 200 with statement and populated transactions array', async () => {
    const withTxns = {
      ...stmt,
      transactions: [
        {
          transactionId: '00000000-0000-4000-8000-000000000020',
          accountId: ACCOUNT_ID,
          type: 'CHARGE',
          merchantName: 'Amazon',
          amount: 100,
          idempotencyKey: '00000000-0000-4000-8000-000000000021',
          createdAt: new Date('2026-05-10T14:00:00Z'),
        },
      ],
    };
    mockInvoke.mockResolvedValueOnce(withTxns);
    const res = await handler(makeEvent('GET', GET_PATH)) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.statementId).toBe(STATEMENT_ID);
    expect(Array.isArray(body.data.transactions)).toBe(true);
    expect(body.data.transactions.length).toBe(1);
  });

  it('returns 404 STATEMENT_NOT_FOUND for unknown statementId', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('STATEMENT_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent('GET', GET_PATH)) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('STATEMENT_NOT_FOUND');
  });
});
