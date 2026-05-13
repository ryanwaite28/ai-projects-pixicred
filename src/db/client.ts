import { PrismaClient } from '@prisma/client';
import { Signer } from '@aws-sdk/rds-signer';
import { getConfig } from '../lib/config.js';

let _prismaPromise: Promise<PrismaClient> | null = null;

async function buildPrismaClient(): Promise<PrismaClient> {
  let databaseUrl: string;
  if (process.env['ENVIRONMENT'] === 'local') {
    databaseUrl = process.env['DATABASE_URL']!;
  } else {
    const { DB_HOST, DB_PORT, DB_NAME, DB_IAM_USER } = await getConfig();
    const signer = new Signer({
      hostname: DB_HOST,
      port: Number(DB_PORT),
      region: process.env['AWS_REGION'] ?? 'us-east-1',
      username: DB_IAM_USER,
    });
    const token = await signer.getAuthToken();
    databaseUrl = `postgresql://${DB_IAM_USER}:${encodeURIComponent(token)}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require`;
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
