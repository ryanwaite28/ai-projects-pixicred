import { describe, test, expect } from 'vitest';
import { createConnection } from 'net';
import { Client as PgClient } from 'pg';
import { SQSClient, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { SNSClient, ListTopicsCommand } from '@aws-sdk/client-sns';

const SQS = new SQSClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const SNS = new SNSClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

describe('Docker stack — integration', () => {
  test('Postgres container accepts TCP connection on port 5432', () =>
    new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: 'localhost', port: 5432 }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', reject);
    }));

  test('Postgres database name is pixicred', async () => {
    const client = new PgClient({
      host: 'localhost',
      port: 5432,
      database: 'pixicred',
      user: 'pixicred',
      password: 'pixicred_local',
    });
    await client.connect();
    const result = await client.query<{ current_database: string }>('SELECT current_database()');
    await client.end();
    expect(result.rows[0]?.current_database).toBe('pixicred');
  });

  test('MiniStack HTTP endpoint responds 200 on GET http://localhost:4566/_ministack/health', async () => {
    const res = await fetch('http://localhost:4566/_ministack/health');
    expect(res.status).toBe(200);
  });

  test('MiniStack has credit-check SQS queue after init', async () => {
    const res = await SQS.send(new GetQueueUrlCommand({ QueueName: 'pixicred-local-credit-check' }));
    expect(res.QueueUrl).toContain('pixicred-local-credit-check');
  });

  test('MiniStack has notifications SQS queue after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-notifications' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-notifications');
  });

  test('MiniStack has statement-gen SQS queue after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-statement-gen' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-statement-gen');
  });

  test('MiniStack has billing-lifecycle SQS queue after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-billing-lifecycle' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-billing-lifecycle');
  });

  test('MiniStack has pixicred-local-events SNS topic after init', async () => {
    const res = await SNS.send(new ListTopicsCommand({}));
    const arns = res.Topics?.map((t) => t.TopicArn ?? '') ?? [];
    expect(arns.some((arn) => arn.includes('pixicred-local-events'))).toBe(true);
  });

  test('credit-check DLQ exists in MiniStack after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-credit-check-dlq' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-credit-check-dlq');
  });

  test('notifications DLQ exists in MiniStack after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-notifications-dlq' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-notifications-dlq');
  });

  test('statement-gen DLQ exists in MiniStack after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-statement-gen-dlq' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-statement-gen-dlq');
  });

  test('billing-lifecycle DLQ exists in MiniStack after init', async () => {
    const res = await SQS.send(
      new GetQueueUrlCommand({ QueueName: 'pixicred-local-billing-lifecycle-dlq' }),
    );
    expect(res.QueueUrl).toContain('pixicred-local-billing-lifecycle-dlq');
  });
});
