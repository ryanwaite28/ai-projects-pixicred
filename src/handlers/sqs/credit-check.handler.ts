import type { SQSEvent } from 'aws-lambda';
import { createServiceClient } from '../../clients/service.client.js';

const serviceClient = createServiceClient();

interface SnsEnvelope {
  Type: string;
  TopicArn: string;
  Message: string;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    // SQS receives the SNS notification envelope; the actual payload is in Message
    const envelope = JSON.parse(record.body) as SnsEnvelope;
    const { payload } = JSON.parse(envelope.Message) as { eventType: string; payload: { applicationId: string } };
    const { applicationId } = payload;
    if (!applicationId || typeof applicationId !== 'string') {
      throw new Error(`Missing applicationId in SQS record: ${record.messageId}`);
    }
    await serviceClient.invoke({ action: 'runCreditCheck', payload: { applicationId } });
  }
};
