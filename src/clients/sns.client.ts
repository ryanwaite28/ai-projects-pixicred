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
          // Embed eventType in the Message body so handlers can route without
          // needing to parse MessageAttributes. MessageAttributes are kept for
          // SNS subscription filter policies (e.g. credit-check only receives
          // APPLICATION_SUBMITTED).
          Message: JSON.stringify({ eventType, payload }),
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: eventType },
          },
        }),
      );
    },
  };
}
