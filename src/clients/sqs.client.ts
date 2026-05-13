import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SqsClient } from '../types/index.js';

export function createSqsClient(): SqsClient {
  const sqs = new SQSClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['AWS_ENDPOINT_URL'] ? { endpoint: process.env['AWS_ENDPOINT_URL'] } : {}),
  });

  return {
    async sendMessage(queueUrl, body) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(body),
        }),
      );
    },
  };
}
