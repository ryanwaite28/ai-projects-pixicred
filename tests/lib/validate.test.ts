import { describe, it, expect } from 'vitest';
import { assertUuid } from '../../src/lib/validate';
import { PixiCredError } from '../../src/lib/errors';

describe('assertUuid', () => {
  it('passes for a valid UUID v4', () => {
    expect(() => assertUuid('123e4567-e89b-42d3-a456-426614174000', 'id')).not.toThrow();
  });

  it('throws VALIDATION_ERROR for an empty string', () => {
    expect(() => assertUuid('', 'myField')).toThrow(PixiCredError);
    try {
      assertUuid('', 'myField');
    } catch (e) {
      expect((e as PixiCredError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('throws VALIDATION_ERROR for a UUID v1', () => {
    // version digit is 1, not 4
    expect(() => assertUuid('123e4567-e89b-12d3-a456-426614174000', 'id')).toThrow(PixiCredError);
  });

  it('throws VALIDATION_ERROR for a random non-UUID string', () => {
    expect(() => assertUuid('not-a-uuid', 'id')).toThrow(PixiCredError);
  });

  it('error message includes the field name', () => {
    try {
      assertUuid('bad-value', 'accountId');
    } catch (e) {
      expect((e as PixiCredError).message).toContain('accountId');
    }
  });
});
