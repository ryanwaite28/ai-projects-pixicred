import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { PixiCredError, toHttpStatus } from '../../lib/errors.js';
import { getConfig } from '../../lib/config.js';
import { validateBearerToken } from '../../lib/jwt.js';
import type { Statement } from '../../types/index.js';

const serviceClient = createServiceClient();

function ok(data: unknown, statusCode = 200): APIGatewayProxyResultV2 {
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
    const accountIdMatch = /^\/accounts\/([^/]+)\/statements/.exec(path);
    if (!accountIdMatch) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
      };
    }
    const { JWT_SECRET } = await getConfig();
    validateBearerToken(event.headers['authorization'], accountIdMatch[1] as string, JWT_SECRET);

    // POST /accounts/:accountId/statements → generateStatement
    const postMatch = /^\/accounts\/([^/]+)\/statements$/.exec(path);
    if (postMatch && method === 'POST') {
      const accountId = postMatch[1] as string;
      const statement = await serviceClient.invoke<Statement>({
        action: 'generateStatement',
        payload: { accountId },
      });
      return ok(statement, 201);
    }

    // GET /accounts/:accountId/statements → getStatements
    const listMatch = /^\/accounts\/([^/]+)\/statements$/.exec(path);
    if (listMatch && method === 'GET') {
      const accountId = listMatch[1] as string;
      const statements = await serviceClient.invoke<Statement[]>({
        action: 'getStatements',
        payload: { accountId },
      });
      return ok(statements);
    }

    // GET /accounts/:accountId/statements/:statementId → getStatement
    const getMatch = /^\/accounts\/([^/]+)\/statements\/([^/]+)$/.exec(path);
    if (getMatch && method === 'GET') {
      const accountId    = getMatch[1] as string;
      const statementId  = getMatch[2] as string;
      const statement = await serviceClient.invoke<Statement>({
        action: 'getStatement',
        payload: { accountId, statementId },
      });
      return ok(statement);
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
