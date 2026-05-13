import type { SQSEvent } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';

const serviceClient = createServiceClient();

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { lookaheadDays } = JSON.parse(record.body) as { lookaheadDays: number };
    if (typeof lookaheadDays !== 'number' || !Number.isInteger(lookaheadDays) || lookaheadDays < 1) {
      throw new Error(`Invalid lookaheadDays in SQS record ${record.messageId}: must be a positive integer`);
    }
    await serviceClient.invoke({ action: 'runBillingLifecycle', payload: { lookaheadDays } });
  }
};
