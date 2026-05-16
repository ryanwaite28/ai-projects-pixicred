import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { log } from '../../lib/logger.js';
import type { Transaction } from '../../types/index.js';

const serviceClient = createServiceClient();

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
    if (method === 'POST' && path === '/merchant/charge') {
      const body = JSON.parse(event.body ?? '{}');
      const { cardNumber, cardCvv, merchantName, amount, idempotencyKey } = body as Record<string, unknown>;

      if (!cardNumber || !cardCvv || !merchantName || amount === undefined || amount === null || !idempotencyKey) {
        throw new PixiCredError('VALIDATION_ERROR', 'cardNumber, cardCvv, merchantName, amount, and idempotencyKey are required');
      }
      if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        throw new PixiCredError('VALIDATION_ERROR', 'amount must be a positive finite number');
      }

      const transaction = await serviceClient.invoke<Transaction>({
        action: 'postMerchantCharge',
        payload: {
          cardNumber: String(cardNumber),
          cardCvv: String(cardCvv),
          merchantName: String(merchantName),
          amount,
          idempotencyKey: String(idempotencyKey),
        },
      });
      log('info', `${method} ${path}`, Date.now() - start, { requestId, status: 201 });
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: transaction }),
      };
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
