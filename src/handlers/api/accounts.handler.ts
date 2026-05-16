import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { getConfig } from '../../lib/config.js';
import { validateBearerToken } from '../../lib/jwt.js';
import { log } from '../../lib/logger.js';
import type { Account } from '../../types/index.js';

const serviceClient = createServiceClient();

function ok(data: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
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
    // POST /accounts/:accountId/card/renew
    const renewMatch = /^\/accounts\/([^/]+)\/card\/renew$/.exec(path);
    if (renewMatch && method === 'POST') {
      const accountId = renewMatch[1] as string;
      const { JWT_SECRET } = await getConfig();
      validateBearerToken(event.headers['authorization'], accountId, JWT_SECRET);
      const account = await serviceClient.invoke<Account>({
        action: 'renewCard',
        payload: { accountId },
      });
      log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 201 });
      return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: account }) };
    }

    const accountMatch = /^\/accounts\/([^/]+)$/.exec(path);

    if (accountMatch) {
      const accountId = accountMatch[1] as string;

      if (!accountId) {
        throw new PixiCredError('VALIDATION_ERROR', 'accountId is required');
      }

      const { JWT_SECRET } = await getConfig();
      validateBearerToken(event.headers['authorization'], accountId, JWT_SECRET);

      // GET /accounts/:accountId
      if (method === 'GET') {
        const account = await serviceClient.invoke<Account>({
          action: 'getAccount',
          payload: { accountId },
        });
        log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 200 });
        return ok(account);
      }

      // DELETE /accounts/:accountId
      if (method === 'DELETE') {
        const account = await serviceClient.invoke<Account>({
          action: 'closeAccount',
          payload: { accountId, reason: 'USER_REQUESTED' },
        });
        log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 200 });
        return ok(account);
      }
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
