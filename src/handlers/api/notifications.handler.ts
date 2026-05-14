import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { getConfig } from '../../lib/config.js';
import { validateBearerToken } from '../../lib/jwt.js';
import { log } from '../../lib/logger.js';
import type { NotificationPreference } from '../../types/index.js';

const serviceClient = createServiceClient();

function ok(data: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) };
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
    const match = /^\/accounts\/([^/]+)\/notifications$/.exec(path);
    if (!match) {
      log('warn', `${method} ${path}`, Date.now() - start, { requestId, status: 404 });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
      };
    }

    const accountId = match[1] as string;
    const { JWT_SECRET } = await getConfig();
    validateBearerToken(event.headers['authorization'], accountId, JWT_SECRET);

    if (method === 'GET') {
      const prefs = await serviceClient.invoke<NotificationPreference>({
        action: 'getNotificationPreferences',
        payload: { accountId },
      });
      log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 200 });
      return ok(prefs);
    }

    if (method === 'PATCH') {
      const body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};
      const { transactionsEnabled, statementsEnabled, paymentRemindersEnabled } = body;
      const hasField =
        typeof transactionsEnabled === 'boolean' ||
        typeof statementsEnabled === 'boolean' ||
        typeof paymentRemindersEnabled === 'boolean';
      if (!hasField) {
        throw new PixiCredError('VALIDATION_ERROR', 'At least one boolean preference field must be provided');
      }
      const prefs = await serviceClient.invoke<NotificationPreference>({
        action: 'updateNotificationPreferences',
        payload: {
          accountId,
          ...(typeof transactionsEnabled === 'boolean' ? { transactionsEnabled } : {}),
          ...(typeof statementsEnabled === 'boolean' ? { statementsEnabled } : {}),
          ...(typeof paymentRemindersEnabled === 'boolean' ? { paymentRemindersEnabled } : {}),
        },
      });
      log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 200 });
      return ok(prefs);
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
