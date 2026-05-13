import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import type { Application } from '../../types/index.js';

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
    // POST /applications
    if (method === 'POST' && path === '/applications') {
      const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;

      if (!body['email'] || !body['firstName'] || !body['lastName'] ||
          !body['dateOfBirth'] || !body['mockSsn']) {
        throw new PixiCredError('VALIDATION_ERROR', 'All fields are required: email, firstName, lastName, dateOfBirth, mockSsn, annualIncome');
      }
      if (typeof body['annualIncome'] !== 'number') {
        throw new PixiCredError('VALIDATION_ERROR', 'annualIncome must be a number');
      }
      if (typeof body['mockSsn'] !== 'string') {
        throw new PixiCredError('VALIDATION_ERROR', 'mockSsn must be a string');
      }

      const application = await serviceClient.invoke<Application>({
        action: 'submitApplication',
        payload: {
          email:        String(body['email']),
          firstName:    String(body['firstName']),
          lastName:     String(body['lastName']),
          dateOfBirth:  String(body['dateOfBirth']),
          annualIncome: body['annualIncome'] as number,
          mockSsn:      body['mockSsn'] as string,
        },
      });
      return ok(201, application);
    }

    // GET /applications/:applicationId
    const getMatch = /^\/applications\/([^/]+)$/.exec(path);
    if (method === 'GET' && getMatch) {
      const applicationId = getMatch[1] as string;
      const application = await serviceClient.invoke<Application>({
        action: 'getApplication',
        payload: { applicationId },
      });
      return ok(200, application);
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
