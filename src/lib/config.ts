import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface AppConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
}

let configPromise: Promise<AppConfig> | null = null;

export function getConfig(): Promise<AppConfig> {
  if (configPromise) return configPromise;

  if (process.env['ENVIRONMENT'] === 'local') {
    configPromise = Promise.resolve({
      DATABASE_URL: process.env['DATABASE_URL']!,
      JWT_SECRET:   process.env['JWT_SECRET']!,
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
