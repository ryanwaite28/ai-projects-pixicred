import { PrismaClient } from '@prisma/client';
import { getConfig } from '../lib/config.js';

let _prismaPromise: Promise<PrismaClient> | null = null;

function withPrismaServerlessParams(url: string): string {
  // pgbouncer=true: disables prepared statements (simple query protocol) to
  // prevent PostgresError 42P05 "prepared statement already exists" on warm
  // Lambda starts where the same connection is reused across invocations.
  // connection_limit=1: one connection per Lambda instance to avoid exhausting
  // RDS max_connections across concurrent invocations.
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}pgbouncer=true&connection_limit=1`;
}

async function buildPrismaClient(): Promise<PrismaClient> {
  let databaseUrl: string;
  if (process.env['ENVIRONMENT'] === 'local') {
    databaseUrl = process.env['DATABASE_URL']!;
  } else {
    const { DATABASE_URL } = await getConfig();
    databaseUrl = DATABASE_URL;
  }
  return new PrismaClient({ datasources: { db: { url: withPrismaServerlessParams(databaseUrl) } } });
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
