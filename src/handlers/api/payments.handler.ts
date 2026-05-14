import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { getConfig } from '../../lib/config.js';
import { validateBearerToken } from '../../lib/jwt.js';
import { log } from '../../lib/logger.js';
import type { Transaction } from '../../types/index.js';

const serviceClient = createServiceClient();

function ok(data: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: 201,
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
    const routeMatch = /^\/accounts\/([^/]+)\/payments$/.exec(path);
    if (!routeMatch || method !== 'POST') {
      log('warn', `${method} ${path}`, Date.now() - start, { requestId, status: 404 });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
      };
    }

    const accountId = routeMatch[1] as string;
    const { JWT_SECRET } = await getConfig();
    validateBearerToken(event.headers['authorization'], accountId, JWT_SECRET);

    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;

    const amount = body['amount'];
    if (amount === undefined || amount === null) {
      throw new PixiCredError('VALIDATION_ERROR', 'amount is required');
    }
    if (amount !== 'FULL') {
      if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        throw new PixiCredError('VALIDATION_ERROR', 'amount must be a positive finite number or "FULL"');
      }
    }

    if (!body['idempotencyKey'] || typeof body['idempotencyKey'] !== 'string') {
      throw new PixiCredError('VALIDATION_ERROR', 'idempotencyKey must be a non-empty string');
    }

    const transaction = await serviceClient.invoke<Transaction>({
      action: 'postPayment',
      payload: {
        accountId,
        amount: amount as number | 'FULL',
        idempotencyKey: body['idempotencyKey'],
      },
    });
    log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 201 });
    return ok(transaction);
  } catch (e) {
    if (e instanceof PixiCredError) {
      log('warn', `${method} ${path}`, Date.now() - start, { requestId, code: e.code, error: e.message });
      return errResponse(e);
    }
    log('error', `${method} ${path}`, Date.now() - start, { requestId, error: String(e) });
    return internalErr();
  }
};
