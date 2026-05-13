import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createSqsClient } from '../../clients/sqs.client.js';
import { PixiCredError } from '../../lib/errors.js';

const sqsClient = createSqsClient();

function accepted(data: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  };
}

function badRequest(message: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message } }),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path   = event.requestContext.http.path;

  try {
    if (method !== 'POST' || path !== '/admin/billing-lifecycle') {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
      };
    }

    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
    let lookaheadDays = 7;

    if (body['lookaheadDays'] !== undefined) {
      const raw = body['lookaheadDays'];
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
        return badRequest('lookaheadDays must be a positive integer');
      }
      lookaheadDays = raw;
    }

    const queueUrl = process.env['BILLING_LIFECYCLE_QUEUE_URL'] ?? '';
    await sqsClient.sendMessage(queueUrl, { lookaheadDays });

    return accepted({ queued: true, lookaheadDays });
  } catch (e) {
    if (e instanceof PixiCredError) {
      return badRequest(e.message);
    }
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } }),
    };
  }
};
