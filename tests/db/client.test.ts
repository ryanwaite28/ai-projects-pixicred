import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPrisma, resetPrismaForTesting } from '../../src/db/client';

const { MockPrismaClient, MockSigner, mockGetAuthToken, mockGetConfig } = vi.hoisted(() => {
  const mockGetAuthToken = vi.fn();
  return {
    MockPrismaClient: vi.fn(() => ({})),
    MockSigner: vi.fn(() => ({ getAuthToken: mockGetAuthToken })),
    mockGetAuthToken,
    mockGetConfig: vi.fn(),
  };
});

vi.mock('@prisma/client', () => ({ PrismaClient: MockPrismaClient }));
vi.mock('@aws-sdk/rds-signer', () => ({ Signer: MockSigner }));
vi.mock('../../src/lib/config', () => ({ getConfig: mockGetConfig }));

describe('db/client', () => {
  beforeEach(() => {
    resetPrismaForTesting();
    MockPrismaClient.mockClear();
    MockSigner.mockClear();
    mockGetAuthToken.mockReset();
    mockGetConfig.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads DATABASE_URL from process.env when ENVIRONMENT is local', async () => {
    vi.stubEnv('ENVIRONMENT', 'local');
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/pixicred');

    await getPrisma();

    expect(MockPrismaClient).toHaveBeenCalledWith({
      datasources: { db: { url: 'postgresql://user:pass@localhost:5432/pixicred' } },
    });
  });

  it('calls getConfig() and generates RDS IAM auth token via rds-signer in non-local mode', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    mockGetConfig.mockResolvedValue({
      DB_HOST: 'rds.example.com',
      DB_PORT: '5432',
      DB_NAME: 'pixicred',
      DB_IAM_USER: 'pixicred_app',
      JWT_SECRET: 'secret',
    });
    mockGetAuthToken.mockResolvedValue('my-rds-token');

    await getPrisma();

    expect(mockGetConfig).toHaveBeenCalled();
    expect(mockGetAuthToken).toHaveBeenCalled();
  });

  it('constructs DATABASE_URL with URL-encoded IAM token', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');
    vi.stubEnv('AWS_REGION', 'us-east-1');

    mockGetConfig.mockResolvedValue({
      DB_HOST: 'rds.example.com',
      DB_PORT: '5432',
      DB_NAME: 'pixicred',
      DB_IAM_USER: 'pixicred_app',
      JWT_SECRET: 'secret',
    });
    mockGetAuthToken.mockResolvedValue('token with spaces/and+special=chars');

    await getPrisma();

    const expectedEncoded = encodeURIComponent('token with spaces/and+special=chars');
    expect(MockPrismaClient).toHaveBeenCalledWith({
      datasources: {
        db: {
          url: `postgresql://pixicred_app:${expectedEncoded}@rds.example.com:5432/pixicred?sslmode=require`,
        },
      },
    });
  });
});
