import * as jwt from 'jsonwebtoken';
import { PixiCredError } from './errors.js';

export function validateBearerToken(
  authHeader: string | undefined,
  expectedAccountId: string,
  jwtSecret: string,
): { accountId: string; email: string } {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new PixiCredError('UNAUTHORIZED', 'Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7);
  let payload: { accountId: string; email: string };
  try {
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as typeof payload;
  } catch {
    throw new PixiCredError('UNAUTHORIZED', 'Invalid or expired JWT');
  }
  if (payload.accountId !== expectedAccountId) {
    throw new PixiCredError('FORBIDDEN', 'JWT accountId does not match resource accountId');
  }
  return payload;
}
