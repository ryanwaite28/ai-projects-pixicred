import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-for-unit-tests';

const { mockDispatch, mockSqsSend } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockSqsSend: vi.fn(),
}));

vi.mock('../../local/../src/handlers/service/service.handler.js', () => ({
  dispatch: mockDispatch,
}));

vi.mock('../../local/../src/clients/sqs.client.js', () => ({
  createSqsClient: () => ({ sendMessage: mockSqsSend }),
}));

process.env['API_SERVER_NO_LISTEN'] = 'true';
process.env['JWT_SECRET'] = JWT_SECRET;

let server: http.Server;
let baseUrl: string;

const ACCOUNT_ID  = '00000000-0000-4000-8000-000000000001';
const APP_ID      = '00000000-0000-4000-8000-000000000002';
const TXN_ID      = '00000000-0000-4000-8000-000000000003';
const STMT_ID     = '00000000-0000-4000-8000-000000000004';
const IDEM_KEY    = '00000000-0000-4000-8000-000000000005';

function makeJwt(accountId: string): string {
  return jwt.sign({ accountId, email: 'test@pixicred.local' }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

async function req<T = unknown>(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

beforeAll(async () => {
  process.env['API_SERVER_NO_LISTEN'] = 'true';
  const { app } = await import('../../local/api-server.js');
  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, () => resolve());
  });
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  mockDispatch.mockReset();
  mockSqsSend.mockReset();
  mockSqsSend.mockResolvedValue(undefined);
});

// ── Application routes ────────────────────────────────────────────────────

describe('POST /applications', () => {
  it('returns 201 PENDING on valid input', async () => {
    mockDispatch.mockResolvedValueOnce({
      applicationId: APP_ID,
      status: 'PENDING',
      email: 'test@example.com',
    });
    const { status, body } = await req('POST', '/applications', {
      body: { email: 'test@example.com', firstName: 'Test', lastName: 'User', dateOfBirth: '1990-01-01', annualIncome: 50000, mockSsn: '12345' },
    });
    expect(status).toBe(201);
    expect((body as { data: { status: string } }).data.status).toBe('PENDING');
  });

  it('returns 409 DUPLICATE_APPLICATION for duplicate email', async () => {
    const { PixiCredError } = await import('../../src/lib/errors.js');
    mockDispatch.mockRejectedValueOnce(new PixiCredError('DUPLICATE_APPLICATION', 'Duplicate'));
    const { status, body } = await req('POST', '/applications', {
      body: { email: 'dup@example.com', firstName: 'Test', lastName: 'User', dateOfBirth: '1990-01-01', annualIncome: 50000, mockSsn: '12345' },
    });
    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe('DUPLICATE_APPLICATION');
  });
});

describe('GET /applications/:applicationId', () => {
  it('returns 200 with application data after credit check completes', async () => {
    mockDispatch.mockResolvedValueOnce({
      applicationId: APP_ID,
      status: 'APPROVED',
      accountId: ACCOUNT_ID,
    });
    const { status, body } = await req('GET', `/applications/${APP_ID}`);
    expect(status).toBe(200);
    expect((body as { data: { status: string } }).data.status).toBe('APPROVED');
  });
});

// ── Transaction routes ────────────────────────────────────────────────────

describe('POST /accounts/:accountId/transactions', () => {
  it('returns 201 with updated balance', async () => {
    mockDispatch.mockResolvedValueOnce({
      transactionId: TXN_ID,
      accountId: ACCOUNT_ID,
      type: 'CHARGE',
      amount: 50,
      idempotencyKey: IDEM_KEY,
      createdAt: new Date().toISOString(),
    });
    const token = makeJwt(ACCOUNT_ID);
    const { status, body } = await req('POST', `/accounts/${ACCOUNT_ID}/transactions`, {
      token,
      body: { type: 'CHARGE', merchantName: 'Test Merchant', amount: 50, idempotencyKey: IDEM_KEY },
    });
    expect(status).toBe(201);
    expect((body as { data: { type: string } }).data.type).toBe('CHARGE');
  });

  it('returns 201 with original transaction on idempotent replay', async () => {
    const original = { transactionId: TXN_ID, accountId: ACCOUNT_ID, type: 'CHARGE', amount: 50, idempotencyKey: IDEM_KEY };
    mockDispatch.mockResolvedValueOnce(original);
    const token = makeJwt(ACCOUNT_ID);
    const { status, body } = await req('POST', `/accounts/${ACCOUNT_ID}/transactions`, {
      token,
      body: { type: 'CHARGE', merchantName: 'Test', amount: 50, idempotencyKey: IDEM_KEY },
    });
    expect(status).toBe(201);
    expect((body as { data: { transactionId: string } }).data.transactionId).toBe(TXN_ID);
  });
});

// ── Payment routes ─────────────────────────────────────────────────────────

describe('POST /accounts/:accountId/payments', () => {
  it('with amount FULL returns 201 and balance reaches zero', async () => {
    mockDispatch.mockResolvedValueOnce({
      transactionId: TXN_ID,
      accountId: ACCOUNT_ID,
      type: 'PAYMENT',
      amount: 500,
      idempotencyKey: IDEM_KEY,
    });
    const token = makeJwt(ACCOUNT_ID);
    const { status, body } = await req('POST', `/accounts/${ACCOUNT_ID}/payments`, {
      token,
      body: { amount: 'FULL', idempotencyKey: IDEM_KEY },
    });
    expect(status).toBe(201);
    expect((body as { data: { type: string } }).data.type).toBe('PAYMENT');
  });
});

// ── Account routes ────────────────────────────────────────────────────────

describe('DELETE /accounts/:accountId', () => {
  it('returns 200 with CLOSED account', async () => {
    mockDispatch.mockResolvedValueOnce({ accountId: ACCOUNT_ID, status: 'CLOSED', closeReason: 'USER_REQUESTED' });
    const token = makeJwt(ACCOUNT_ID);
    const { status, body } = await req('DELETE', `/accounts/${ACCOUNT_ID}`, { token });
    expect(status).toBe(200);
    expect((body as { data: { status: string } }).data.status).toBe('CLOSED');
  });
});

// ── Statement routes ──────────────────────────────────────────────────────

describe('POST /accounts/:accountId/statements', () => {
  it('returns 201 with generated statement', async () => {
    mockDispatch.mockResolvedValueOnce({ statementId: STMT_ID, accountId: ACCOUNT_ID });
    const token = makeJwt(ACCOUNT_ID);
    const { status, body } = await req('POST', `/accounts/${ACCOUNT_ID}/statements`, { token });
    expect(status).toBe(201);
    expect((body as { data: { statementId: string } }).data.statementId).toBe(STMT_ID);
  });
});

// ── Notification routes ───────────────────────────────────────────────────

describe('PATCH /accounts/:accountId/notifications', () => {
  it('returns 200 with updated preferences', async () => {
    mockDispatch.mockResolvedValueOnce({ accountId: ACCOUNT_ID, transactionsEnabled: false, statementsEnabled: true, paymentRemindersEnabled: true });
    const token = makeJwt(ACCOUNT_ID);
    const { status, body } = await req('PATCH', `/accounts/${ACCOUNT_ID}/notifications`, {
      token,
      body: { transactionsEnabled: false },
    });
    expect(status).toBe(200);
    expect((body as { data: { transactionsEnabled: boolean } }).data.transactionsEnabled).toBe(false);
  });
});

// ── Admin routes ──────────────────────────────────────────────────────────

describe('POST /admin/billing-lifecycle', () => {
  it('returns 202 immediately', async () => {
    const { status, body } = await req('POST', '/admin/billing-lifecycle');
    expect(status).toBe(202);
    expect((body as { data: { queued: boolean } }).data.queued).toBe(true);
    expect(mockSqsSend).toHaveBeenCalled();
  });
});

// ── 404 fallback ──────────────────────────────────────────────────────────

describe('unknown route', () => {
  it('GET /nonexistent-route returns 404', async () => {
    const { status, body } = await req('GET', '/nonexistent-route');
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});

// ── JWT enforcement ───────────────────────────────────────────────────────

describe('JWT enforcement', () => {
  it('GET /accounts/:accountId without JWT returns 401 UNAUTHORIZED', async () => {
    const { status, body } = await req('GET', `/accounts/${ACCOUNT_ID}`);
    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /accounts/:accountId with JWT for different accountId returns 403 FORBIDDEN', async () => {
    const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000000099';
    const token = makeJwt(OTHER_ACCOUNT);
    const { status, body } = await req('GET', `/accounts/${ACCOUNT_ID}`, { token });
    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });
});
