import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfigForTesting } from '../../src/lib/config';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: vi.fn((input: unknown) => input),
}));

describe('getConfig', () => {
  beforeEach(() => {
    resetConfigForTesting();
    mockSend.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns env vars directly when ENVIRONMENT is local', async () => {
    vi.stubEnv('ENVIRONMENT', 'local');
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_NAME', 'pixicred');
    vi.stubEnv('DB_IAM_USER', 'pixicred_app');
    vi.stubEnv('JWT_SECRET', 'test-secret');

    const config = await getConfig();

    expect(config).toEqual({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_NAME: 'pixicred',
      DB_IAM_USER: 'pixicred_app',
      JWT_SECRET: 'test-secret',
    });
  });

  it('fetches secret from Secrets Manager when ENVIRONMENT is not local', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        DB_HOST: 'rds.example.com',
        DB_PORT: '5432',
        DB_NAME: 'pixicred',
        DB_IAM_USER: 'pixicred_app',
        JWT_SECRET: 'prod-secret',
      }),
    });

    await getConfig();

    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns JWT_SECRET from fetched secret', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        DB_HOST: 'rds.example.com',
        DB_PORT: '5432',
        DB_NAME: 'pixicred',
        DB_IAM_USER: 'pixicred_app',
        JWT_SECRET: 'my-jwt-secret',
      }),
    });

    const config = await getConfig();

    expect(config.JWT_SECRET).toBe('my-jwt-secret');
  });

  it('caches the result — Secrets Manager is called only once across multiple getConfig() calls', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        DB_HOST: 'rds.example.com',
        DB_PORT: '5432',
        DB_NAME: 'pixicred',
        DB_IAM_USER: 'pixicred_app',
        JWT_SECRET: 'cached-secret',
      }),
    });

    await getConfig();
    await getConfig();
    await getConfig();

    expect(mockSend).toHaveBeenCalledOnce();
  });
});
