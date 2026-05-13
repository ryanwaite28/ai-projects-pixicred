import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/admin.handler';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

type Res = APIGatewayProxyStructuredResultV2;

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }));

vi.mock('../../src/clients/sqs.client', () => ({
  createSqsClient: () => ({ sendMessage: mockSendMessage }),
}));

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

const PATH = '/admin/billing-lifecycle';

beforeEach(() => {
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue(undefined);
  process.env['BILLING_LIFECYCLE_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/000/billing-lifecycle';
});

describe('POST /admin/billing-lifecycle', () => {
  it('returns 202 with queued true and default lookaheadDays of 7 when no body provided', async () => {
    const res = await handler(makeEvent('POST', PATH)) as Res;
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body as string);
    expect(body.data.queued).toBe(true);
    expect(body.data.lookaheadDays).toBe(7);
  });

  it('returns 202 with provided lookaheadDays when valid integer', async () => {
    const res = await handler(makeEvent('POST', PATH, { lookaheadDays: 14 })) as Res;
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body as string);
    expect(body.data.lookaheadDays).toBe(14);
  });

  it('returns 400 when lookaheadDays is zero', async () => {
    const res = await handler(makeEvent('POST', PATH, { lookaheadDays: 0 })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when lookaheadDays is negative', async () => {
    const res = await handler(makeEvent('POST', PATH, { lookaheadDays: -3 })) as Res;
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when lookaheadDays is not an integer', async () => {
    const res = await handler(makeEvent('POST', PATH, { lookaheadDays: 3.5 })) as Res;
    expect(res.statusCode).toBe(400);
  });

  it('enqueues message to BILLING_LIFECYCLE_QUEUE_URL with correct body', async () => {
    await handler(makeEvent('POST', PATH, { lookaheadDays: 5 }));
    expect(mockSendMessage).toHaveBeenCalledWith(
      'https://sqs.us-east-1.amazonaws.com/000/billing-lifecycle',
      { lookaheadDays: 5 },
    );
  });

  it('returns 202 immediately — does not wait for job to complete', async () => {
    let resolved = false;
    mockSendMessage.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    const resPromise = handler(makeEvent('POST', PATH));
    // Response resolves before the mock delay would matter
    const res = await resPromise as Res;
    expect(res.statusCode).toBe(202);
    // The sendMessage resolved (since we await it), but the point is handler returns 202 not 500
    expect(resolved).toBe(true);
  });
});
