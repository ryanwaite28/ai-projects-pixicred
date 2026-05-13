import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/handlers/api/applications.handler';
import { PixiCredError } from '../../src/lib/errors';
import type { Application } from '../../src/types/index';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

type Res = APIGatewayProxyStructuredResultV2;

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('../../src/clients/service.client', () => ({
  createServiceClient: () => ({ invoke: mockInvoke }),
}));

function makeEvent(
  method: string,
  path: string,
  body?: unknown,
  pathParams: Record<string, string> = {},
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
    pathParameters: pathParams,
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const pendingApp: Application = {
  applicationId: '00000000-0000-4000-8000-000000000001',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-06-15',
  annualIncome: 75000,
  mockSsn: '12345',
  status: 'PENDING',
  creditLimit: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  decidedAt: null,
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('POST /applications', () => {
  const validBody = {
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-06-15',
    annualIncome: 75000,
    mockSsn: '12345',
  };

  it('returns 201 with PENDING application on valid input', async () => {
    mockInvoke.mockResolvedValueOnce(pendingApp);
    const res = await handler(makeEvent('POST', '/applications', validBody)) as Res;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.data.status).toBe('PENDING');
    expect(body.data.email).toBe('jane@example.com');
  });

  it('returns 400 when email is missing', async () => {
    const res = await handler(makeEvent('POST', '/applications', { ...validBody, email: '' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when mockSsn is not a string of 5 characters', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('VALIDATION_ERROR', 'mockSsn must be exactly 5 digits'));
    const res = await handler(makeEvent('POST', '/applications', { ...validBody, mockSsn: '123' })) as Res;
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when annualIncome is not a number', async () => {
    const res = await handler(makeEvent('POST', '/applications', { ...validBody, annualIncome: 'notanumber' })) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 DUPLICATE_APPLICATION when active record exists for email', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('DUPLICATE_APPLICATION', 'Active record exists'));
    const res = await handler(makeEvent('POST', '/applications', validBody)) as Res;
    expect(res.statusCode).toBe(409);

    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('DUPLICATE_APPLICATION');
  });
});

describe('GET /applications/:applicationId', () => {
  it('returns 200 with application data', async () => {
    mockInvoke.mockResolvedValueOnce(pendingApp);
    const res = await handler(makeEvent('GET', '/applications/00000000-0000-4000-8000-000000000001')) as Res;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.data.applicationId).toBe(pendingApp.applicationId);
  });

  it('returns 404 APPLICATION_NOT_FOUND for unknown id', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('APPLICATION_NOT_FOUND', 'Not found'));
    const res = await handler(makeEvent('GET', '/applications/00000000-0000-4000-8000-000000000099')) as Res;
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('APPLICATION_NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for non-UUID id', async () => {
    mockInvoke.mockRejectedValueOnce(new PixiCredError('VALIDATION_ERROR', 'applicationId must be a valid UUID v4'));
    const res = await handler(makeEvent('GET', '/applications/not-a-uuid')) as Res;
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
