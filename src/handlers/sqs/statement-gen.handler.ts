import type { SQSEvent } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';

const serviceClient = createServiceClient();

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body) as { period: unknown };
    if (body.period !== 'weekly' && body.period !== 'monthly') {
      throw new Error(`Invalid period in SQS record ${record.messageId}: must be 'weekly' or 'monthly'`);
    }
    await serviceClient.invoke({
      action: 'generateAllStatements',
      payload: { period: body.period as 'weekly' | 'monthly' },
    });
  }
};
