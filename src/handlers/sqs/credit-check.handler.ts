import type { SQSEvent } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';

const serviceClient = createServiceClient();

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { applicationId } = JSON.parse(record.body) as { applicationId: string };
    if (!applicationId || typeof applicationId !== 'string') {
      throw new Error(`Missing applicationId in SQS record: ${record.messageId}`);
    }
    await serviceClient.invoke({ action: 'runCreditCheck', payload: { applicationId } });
  }
};
