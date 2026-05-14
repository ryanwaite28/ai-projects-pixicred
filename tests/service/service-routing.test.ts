import { describe, it, expect, vi } from 'vitest';
import { dispatch, handler } from '../../src/handlers/service/service.handler';
import { PixiCredError } from '../../src/lib/errors';
import * as accountService from '../../src/service/account.service';
import type { ServiceAction } from '../../src/types/index';

async function expectNotImplemented(action: ServiceAction): Promise<void> {
  const result = dispatch(action);
  await expect(result).rejects.toBeInstanceOf(PixiCredError);
  await expect(dispatch(action)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
}

// Minimal stub payloads — stubs throw immediately so shapes don't matter
describe('service dispatch — stub routing', () => {
  // All actions through Phase 9 are implemented; no remaining NOT_IMPLEMENTED stubs.
});

describe('service handler — error wrapping', () => {
  it('re-throws PixiCredError as-is without wrapping', async () => {
    // assertUuid('x', 'accountId') throws VALIDATION_ERROR before any DB access
    const err = await handler({ action: 'getNotificationPreferences', payload: { accountId: 'x' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('VALIDATION_ERROR');
  });

  it('wraps unknown errors as INTERNAL_ERROR PixiCredError', async () => {
    vi.spyOn(accountService, 'getAccount').mockRejectedValueOnce(new Error('raw error'));
    const err = await handler({ action: 'getAccount', payload: { accountId: 'x' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PixiCredError);
    expect((err as PixiCredError).code).toBe('INTERNAL_ERROR');
    vi.restoreAllMocks();
  });
});
