import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { getAccountById } from '../db/queries/account.queries.js';
import { getApplicationById } from '../db/queries/application.queries.js';
import {
  createPortalAccount,
  getPortalAccountByEmail,
  portalAccountExistsForAccountId,
} from '../db/queries/auth.queries.js';
import { PixiCredError } from '../lib/errors.js';
import { getConfig } from '../lib/config.js';
import type { ServiceClients } from '../types/index.js';

export async function registerPortalAccount(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { email: string; accountId: string; password: string },
): Promise<{ accountId: string }> {
  const account = await getAccountById(prisma, input.accountId);
  if (!account) throw new PixiCredError('ACCOUNT_NOT_FOUND', 'Account not found');

  const application = await getApplicationById(prisma, account.applicationId);
  if (!application || application.status !== 'APPROVED') {
    throw new PixiCredError('PORTAL_ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible for portal registration');
  }

  const exists = await portalAccountExistsForAccountId(prisma, input.accountId);
  if (exists) throw new PixiCredError('PORTAL_ACCOUNT_EXISTS', 'Portal account already exists for this account');

  const passwordHash = await bcrypt.hash(input.password, 12);
  await createPortalAccount(prisma, input.accountId, input.email, passwordHash);

  return { accountId: input.accountId };
}

export async function loginPortalAccount(
  prisma: PrismaClient,
  _clients: ServiceClients,
  input: { email: string; password: string },
): Promise<{ token: string; accountId: string }> {
  const record = await getPortalAccountByEmail(prisma, input.email);
  if (!record) throw new PixiCredError('INVALID_CREDENTIALS', 'Invalid email or password');

  const passwordMatch = await bcrypt.compare(input.password, record.passwordHash);
  if (!passwordMatch) throw new PixiCredError('INVALID_CREDENTIALS', 'Invalid email or password');

  const { JWT_SECRET } = await getConfig();
  const token = jwt.sign(
    { accountId: record.accountId, email: input.email },
    JWT_SECRET,
    { expiresIn: '24h', algorithm: 'HS256' },
  );

  return { token, accountId: record.accountId };
}
