import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { getConfig } from '../../lib/config.js';
import { validateBearerToken } from '../../lib/jwt.js';
import type { Transaction } from '../../types/index.js';

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
    const routeMatch = /^\/accounts\/([^/]+)\/transactions$/.exec(path);
    if (!routeMatch) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
      };
    }

    const accountId = routeMatch[1] as string;
    const { JWT_SECRET } = await getConfig();
    validateBearerToken(event.headers['authorization'], accountId, JWT_SECRET);

    // POST /accounts/:accountId/transactions
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;

      if (!body['merchantName'] || typeof body['merchantName'] !== 'string') {
        throw new PixiCredError('VALIDATION_ERROR', 'merchantName must be a non-empty string');
      }
      if (typeof body['amount'] !== 'number' || !isFinite(body['amount'])) {
        throw new PixiCredError('VALIDATION_ERROR', 'amount must be a finite number');
      }
      if (!body['idempotencyKey'] || typeof body['idempotencyKey'] !== 'string') {
        throw new PixiCredError('VALIDATION_ERROR', 'idempotencyKey must be a non-empty string');
      }

      const transaction = await serviceClient.invoke<Transaction>({
        action: 'postCharge',
        payload: {
          accountId,
          merchantName: body['merchantName'],
          amount: body['amount'] as number,
          idempotencyKey: body['idempotencyKey'],
        },
      });
      return ok(201, transaction);
    }

    // GET /accounts/:accountId/transactions
    if (method === 'GET') {
      const qs = event.queryStringParameters ?? {};
      const cursor = qs['cursor'] ?? undefined;
      const limitRaw = qs['limit'];
      const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;

      const transactions = await serviceClient.invoke<Transaction[]>({
        action: 'getTransactions',
        payload: {
          accountId,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined && !isNaN(limit) ? { limit } : {}),
        },
      });
      return ok(200, transactions);
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
