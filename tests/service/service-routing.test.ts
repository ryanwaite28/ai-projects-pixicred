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
  // submitApplication, getApplication, runCreditCheck implemented in Phase 2
  // getAccount, closeAccount implemented in Phase 3a
  // postCharge, getTransactions implemented in Phase 3b
  // postPayment implemented in Phase 4
  // generateStatement, generateAllStatements, getStatements, getStatement implemented in Phase 5
  // runBillingLifecycle implemented in Phase 4.5
  // getNotificationPreferences, updateNotificationPreferences, sendDeclineEmail, sendApprovalEmail,
  // sendTransactionEmail, sendStatementEmail, sendPaymentDueReminderEmail, sendAutoCloseEmail,
  // sendUserCloseEmail implemented in Phase 6

  it('throws NOT_IMPLEMENTED for registerPortalAccount', () =>
    expectNotImplemented({ action: 'registerPortalAccount', payload: { email: 'a@b.com', accountId: 'x', password: 'pw' } }));

  it('throws NOT_IMPLEMENTED for loginPortalAccount', () =>
    expectNotImplemented({ action: 'loginPortalAccount', payload: { email: 'a@b.com', password: 'pw' } }));
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
