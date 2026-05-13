import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';

const serviceClient = createServiceClient();

function ok(statusCode: number, data: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  };
}

function err(error: PixiCredError): APIGatewayProxyResultV2 {
  return {
    statusCode: toHttpStatus(error.code),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code: error.code, message: error.message } }),
  };
}

function internalErr(): APIGatewayProxyResultV2 {
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } }),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path   = event.requestContext.http.path;

  try {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;

    if (method === 'POST' && path === '/auth/register') {
      const { email, accountId, password } = body;
      if (!email || !accountId || !password) {
        throw new PixiCredError('VALIDATION_ERROR', 'email, accountId, and password are required');
      }
      if (typeof password === 'string' && password.length < 8) {
        throw new PixiCredError('VALIDATION_ERROR', 'password must be at least 8 characters');
      }
      const result = await serviceClient.invoke<{ accountId: string }>({
        action: 'registerPortalAccount',
        payload: { email: email as string, accountId: accountId as string, password: password as string },
      });
      return ok(201, result);
    }

    if (method === 'POST' && path === '/auth/login') {
      const { email, password } = body;
      if (!email || !password) {
        throw new PixiCredError('VALIDATION_ERROR', 'email and password are required');
      }
      const result = await serviceClient.invoke<{ token: string; accountId: string }>({
        action: 'loginPortalAccount',
        payload: { email: email as string, password: password as string },
      });
      return ok(200, result);
    }

    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
    };
  } catch (e) {
    if (e instanceof PixiCredError) return err(e);
    return internalErr();
  }
};
