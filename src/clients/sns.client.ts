import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { SnsClient } from '../types/index.js';

export function createSnsClient(): SnsClient {
  const sns = new SNSClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['AWS_ENDPOINT_URL'] ? { endpoint: process.env['AWS_ENDPOINT_URL'] } : {}),
  });

  return {
    async publishEvent(topicArn, eventType, payload) {
      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: JSON.stringify(payload),
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: eventType },
          },
        }),
      );
    },
  };
}
