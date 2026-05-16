import { describe, it, expect } from 'vitest';
import { PixiCredError, toHttpStatus, type ErrorCode } from '../../src/lib/errors';

describe('PixiCredError', () => {
  it('has name PixiCredError', () => {
    const err = new PixiCredError('VALIDATION_ERROR', 'bad input');
    expect(err.name).toBe('PixiCredError');
  });

  it('stores code and message', () => {
    const err = new PixiCredError('ACCOUNT_NOT_FOUND', 'not found');
    expect(err.code).toBe('ACCOUNT_NOT_FOUND');
    expect(err.message).toBe('not found');
  });

  it('is an instance of Error', () => {
    const err = new PixiCredError('INTERNAL_ERROR', 'boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('toHttpStatus', () => {
  const cases: Array<[ErrorCode, number]> = [
    ['VALIDATION_ERROR',            400],
    ['DUPLICATE_APPLICATION',       409],
    ['APPLICATION_NOT_FOUND',       404],
    ['ACCOUNT_NOT_FOUND',           404],
    ['ACCOUNT_NOT_ACTIVE',          422],
    ['PAYMENT_EXCEEDS_BALANCE',     422],
    ['STATEMENT_NOT_FOUND',         404],
    ['ACCOUNT_ALREADY_CLOSED',      422],
    ['UNAUTHORIZED',                401],
    ['FORBIDDEN',                   403],
    ['INVALID_CREDENTIALS',         401],
    ['PORTAL_ACCOUNT_EXISTS',       409],
    ['PORTAL_ACCOUNT_NOT_ELIGIBLE', 422],
    ['CARD_NOT_FOUND',              404],
    ['INVALID_CARD_CVV',            422],
    ['CARD_EXPIRED',                422],
    ['TRANSACTION_NOT_FOUND',       404],
    ['TRANSACTION_NOT_DISPUTABLE',  422],
    ['NOT_IMPLEMENTED',             501],
    ['INTERNAL_ERROR',              500],
  ];

  it.each(cases)('returns %s → %i', (code, expected) => {
    expect(toHttpStatus(code)).toBe(expected);
  });
});
