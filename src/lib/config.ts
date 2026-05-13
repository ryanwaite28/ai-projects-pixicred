import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface AppConfig {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_IAM_USER: string;
  JWT_SECRET: string;
}

let configPromise: Promise<AppConfig> | null = null;

export function getConfig(): Promise<AppConfig> {
  if (configPromise) return configPromise;

  if (process.env['ENVIRONMENT'] === 'local') {
    configPromise = Promise.resolve({
      DB_HOST:     process.env['DB_HOST']!,
      DB_PORT:     process.env['DB_PORT']!,
      DB_NAME:     process.env['DB_NAME']!,
      DB_IAM_USER: process.env['DB_IAM_USER']!,
      JWT_SECRET:  process.env['JWT_SECRET']!,
    });
  } else {
    configPromise = (async () => {
      const sm = new SecretsManagerClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
      const secret = await sm.send(
        new GetSecretValueCommand({
          SecretId: `pixicred-${process.env['ENVIRONMENT']}-secrets`,
        }),
      );
      return JSON.parse(secret.SecretString!) as AppConfig;
    })();
  }

  return configPromise;
}

export function resetConfigForTesting(): void {
  configPromise = null;
}
