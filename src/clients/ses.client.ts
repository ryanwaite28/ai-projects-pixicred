import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { SesClient } from '../types/index.js';

export function createSesClient(fromAddress: string): SesClient {
  const ses = new SESClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['AWS_ENDPOINT_URL'] ? { endpoint: process.env['AWS_ENDPOINT_URL'] } : {}),
  });

  return {
    async sendEmail(input) {
      await ses.send(
        new SendEmailCommand({
          Source: fromAddress,
          Destination: { ToAddresses: [input.to] },
          Message: {
            Subject: { Data: input.subject },
            Body: {
              Html: { Data: input.htmlBody },
              Text: { Data: input.textBody },
            },
          },
        }),
      );
    },
  };
}
