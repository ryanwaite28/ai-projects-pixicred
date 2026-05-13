import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { PixiCredError } from '../lib/errors.js';
import type { ErrorCode } from '../lib/errors.js';
import type { ServiceAction } from '../types/index.js';

export interface ServiceClient {
  invoke<T = unknown>(action: ServiceAction): Promise<T>;
}

function createLocalClient(endpoint: string): ServiceClient {
  return {
    async invoke<T>(action: ServiceAction): Promise<T> {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const body = (await res.json()) as {
        data?: T;
        error?: { code: ErrorCode; message: string };
      };
      if (body.error) {
        throw new PixiCredError(body.error.code, body.error.message);
      }
      return body.data as T;
    },
  };
}

function createLambdaInvoker(functionArn: string): ServiceClient {
  const lambda = new LambdaClient({});
  return {
    async invoke<T>(action: ServiceAction): Promise<T> {
      const res = await lambda.send(
        new InvokeCommand({
          FunctionName: functionArn,
          Payload: new TextEncoder().encode(JSON.stringify(action)),
        }),
      );
      if (!res.Payload) {
        throw new PixiCredError('INTERNAL_ERROR', 'Empty payload from service Lambda');
      }
      const payload = JSON.parse(new TextDecoder().decode(res.Payload)) as unknown;
      if (res.FunctionError) {
        const err = payload as { code?: ErrorCode; message?: string };
        throw new PixiCredError(
          err.code ?? 'INTERNAL_ERROR',
          err.message ?? 'Service Lambda error',
        );
      }
      return payload as T;
    },
  };
}

export function createServiceClient(): ServiceClient {
  if (process.env['ENVIRONMENT'] === 'local') {
    const endpoint = process.env['SERVICE_ENDPOINT'] ?? 'http://localhost:3001';
    return createLocalClient(endpoint);
  }
  const arn = process.env['SERVICE_LAMBDA_ARN'] ?? '';
  return createLambdaInvoker(arn);
}
