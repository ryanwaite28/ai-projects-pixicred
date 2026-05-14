import { PrismaClient } from '@prisma/client';
import { getConfig } from '../lib/config.js';

let _prismaPromise: Promise<PrismaClient> | null = null;

async function buildPrismaClient(): Promise<PrismaClient> {
  let databaseUrl: string;
  if (process.env['ENVIRONMENT'] === 'local') {
    databaseUrl = process.env['DATABASE_URL']!;
  } else {
    const { DATABASE_URL } = await getConfig();
    databaseUrl = DATABASE_URL;
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export function getPrisma(): Promise<PrismaClient> {
  if (!_prismaPromise) {
    _prismaPromise = buildPrismaClient();
  }
  return _prismaPromise;
}

export function resetPrismaForTesting(): void {
  _prismaPromise = null;
}
