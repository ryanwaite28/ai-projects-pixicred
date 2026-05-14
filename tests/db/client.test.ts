import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPrisma, resetPrismaForTesting } from '../../src/db/client';

const { MockPrismaClient, mockGetConfig } = vi.hoisted(() => ({
  MockPrismaClient: vi.fn(() => ({})),
  mockGetConfig: vi.fn(),
}));

vi.mock('@prisma/client', () => ({ PrismaClient: MockPrismaClient }));
vi.mock('../../src/lib/config', () => ({ getConfig: mockGetConfig }));

describe('db/client', () => {
  beforeEach(() => {
    resetPrismaForTesting();
    MockPrismaClient.mockClear();
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

  it('calls getConfig() and uses DATABASE_URL from Secrets Manager in non-local mode', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');

    mockGetConfig.mockResolvedValue({
      DATABASE_URL: 'postgresql://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
      JWT_SECRET: 'secret',
    });

    await getPrisma();

    expect(mockGetConfig).toHaveBeenCalled();
    expect(MockPrismaClient).toHaveBeenCalledWith({
      datasources: {
        db: {
          url: 'postgresql://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
        },
      },
    });
  });

  it('caches the PrismaClient — buildPrismaClient is called only once across multiple getPrisma() calls', async () => {
    vi.stubEnv('ENVIRONMENT', 'dev');

    mockGetConfig.mockResolvedValue({
      DATABASE_URL: 'postgresql://user:pass@supabase.co:6543/postgres',
      JWT_SECRET: 'secret',
    });

    await getPrisma();
    await getPrisma();
    await getPrisma();

    expect(MockPrismaClient).toHaveBeenCalledOnce();
  });
});
