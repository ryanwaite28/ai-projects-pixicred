import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { PixiCredError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
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
      const start = Date.now();
      const res = await lambda.send(
        new InvokeCommand({
          FunctionName: functionArn,
          Payload: new TextEncoder().encode(JSON.stringify(action)),
        }),
      );
      if (!res.Payload) {
        log('error', `service-invoke:${action.action}`, Date.now() - start, { error: 'empty payload from service Lambda' });
        throw new PixiCredError('INTERNAL_ERROR', 'Empty payload from service Lambda');
      }
      const payload = JSON.parse(new TextDecoder().decode(res.Payload)) as unknown;
      if (res.FunctionError) {
        // Lambda serializes thrown errors as { errorMessage, errorType, stackTrace }
        // Custom properties like `code` may also be present on PixiCredError instances
        const raw = payload as { errorMessage?: string; errorType?: string; code?: ErrorCode; message?: string };
        log('error', `service-invoke:${action.action}`, Date.now() - start, {
          functionError: res.FunctionError,
          errorType: raw.errorType,
          errorMessage: raw.errorMessage,
          code: raw.code,
        });
        const code = raw.code ?? 'INTERNAL_ERROR';
        const message = raw.message ?? raw.errorMessage ?? 'Service Lambda error';
        throw new PixiCredError(code, message);
      }
      log('info', `service-invoke:${action.action}`, Date.now() - start);
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
