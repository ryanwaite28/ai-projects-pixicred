import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { log } from '../../lib/logger.js';

const serviceClient = createServiceClient();

function ok(statusCode: number, data: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  };
}

function errResponse(error: PixiCredError): APIGatewayProxyResultV2 {
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
  const requestId = event.requestContext.requestId;
  const start = Date.now();

  log('info', `${method} ${path}`, 0, { requestId });

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
      log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 201 });
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
      log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 200 });
      return ok(200, result);
    }

    log('warn', `${method} ${path}`, Date.now() - start, { requestId, status: 404 });
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
    };
  } catch (e) {
    if (e instanceof PixiCredError) {
      log('warn', `${method} ${path}`, Date.now() - start, { requestId, code: e.code, error: e.message });
      return errResponse(e);
    }
    log('error', `${method} ${path}`, Date.now() - start, { requestId, error: String(e) });
    return internalErr();
  }
};
