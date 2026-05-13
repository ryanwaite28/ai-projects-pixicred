import { describe, it, expect } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { validateBearerToken } from '../../src/lib/jwt';
import { PixiCredError } from '../../src/lib/errors';

const SECRET = 'test-jwt-secret';
const ACCOUNT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const EMAIL = 'user@example.com';

function makeToken(
  payload: Record<string, unknown> = { accountId: ACCOUNT_ID, email: EMAIL },
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', ...options });
}

describe('validateBearerToken', () => {
  it('throws UNAUTHORIZED when Authorization header is absent', () => {
    expect(() => validateBearerToken(undefined, ACCOUNT_ID, SECRET))
      .toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('throws UNAUTHORIZED when Authorization header does not start with Bearer', () => {
    expect(() => validateBearerToken('Basic abc123', ACCOUNT_ID, SECRET))
      .toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('throws UNAUTHORIZED when token signature is invalid', () => {
    const token = makeToken() + 'tampered';
    expect(() => validateBearerToken(`Bearer ${token}`, ACCOUNT_ID, SECRET))
      .toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('throws UNAUTHORIZED when token is expired', () => {
    const token = makeToken({}, { expiresIn: '-1s' });
    expect(() => validateBearerToken(`Bearer ${token}`, ACCOUNT_ID, SECRET))
      .toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('throws FORBIDDEN when JWT accountId does not match expectedAccountId', () => {
    const token = makeToken({ accountId: 'different-account-id', email: EMAIL });
    expect(() => validateBearerToken(`Bearer ${token}`, ACCOUNT_ID, SECRET))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('returns decoded payload when token is valid and accountId matches', () => {
    const token = makeToken();
    const payload = validateBearerToken(`Bearer ${token}`, ACCOUNT_ID, SECRET);
    expect(payload.accountId).toBe(ACCOUNT_ID);
    expect(payload.email).toBe(EMAIL);
    expect(payload).toBeInstanceOf(Object);
  });

  it('all thrown errors are PixiCredError instances', () => {
    expect(() => validateBearerToken(undefined, ACCOUNT_ID, SECRET))
      .toThrow(PixiCredError);
  });
});
