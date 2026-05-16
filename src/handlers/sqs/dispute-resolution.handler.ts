import type { SQSEvent } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';
import { log } from '../../lib/logger.js';

const serviceClient = createServiceClient();

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const _record of event.Records) {
    const start = Date.now();
    const result = await serviceClient.invoke({
      action:  'resolveDisputes',
      payload: {},
    }) as { resolved: number };
    log('info', 'resolveDisputes', Date.now() - start, { resolved: result.resolved });
  }
};
