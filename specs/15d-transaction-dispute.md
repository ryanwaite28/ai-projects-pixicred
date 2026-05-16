# Spec: Transaction Dispute API (Phase 12d)
**FR references**: FR-TXN-11, FR-NOTIF-07
**Status**: ✅ Implemented
**Prerequisite**: Phase 12b ✅ (POSTED status exists), Phase 12f ✅ (dispute confirmation email template exists)

---

## What

Phase 12d adds the dispute endpoint: `POST /accounts/:accountId/transactions/:transactionId/dispute`. Only `POSTED` transactions can be disputed. The service layer transitions the transaction to `DISPUTED`, stamps `status_updated_at`, and publishes a `TRANSACTION_DISPUTED` SNS event. The notification Lambda routes this event to `sendDisputeConfirmationEmail()`. The dispute email is **always sent** regardless of the account's `transactionsEnabled` preference.

---

## Why

FR-TXN-11 requires cardholders to be able to dispute a POSTED transaction as a self-service action. FR-NOTIF-07 requires dispute emails to bypass preference gating because they are user-action confirmations.

---

## New / Modified Files

### Service layer
- `src/service/transaction.service.ts` — add `disputeTransaction(prisma, clients, input: { accountId: string; transactionId: string }): Promise<Transaction>`

### Errors
- `src/lib/errors.ts` — add `TRANSACTION_NOT_FOUND` → 404 and `TRANSACTION_NOT_DISPUTABLE` → 422

### Query layer
- `src/db/queries/transaction.queries.ts` — add `getTransactionById(prisma, accountId: string, transactionId: string): Promise<Transaction | null>`
- `src/db/queries/transaction.queries.ts` — reuse `updateTransactionStatus` (added in Phase 12c)

### Types
- `src/types/index.ts` — add `disputeTransaction` to `ServiceAction` union

### Handlers
- `src/handlers/api/transactions.handler.ts` — add route `POST /accounts/:accountId/transactions/:transactionId/dispute`
- `src/handlers/service/service.handler.ts` — add `disputeTransaction` dispatch case

### Notification service
- `src/service/notification.service.ts` — add handler for `TRANSACTION_DISPUTED` event → calls `sendDisputeConfirmationEmail()`

---

## Behavior

### `disputeTransaction` service function

```typescript
export async function disputeTransaction(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { accountId: string; transactionId: string }
): Promise<Transaction> {
  assertUuid(input.accountId, 'accountId');
  assertUuid(input.transactionId, 'transactionId');

  const tx = await getTransactionById(prisma, input.accountId, input.transactionId);
  if (!tx) throw new PixiCredError('TRANSACTION_NOT_FOUND', 'Transaction not found');
  if (tx.status !== 'POSTED') throw new PixiCredError('TRANSACTION_NOT_DISPUTABLE', 'Only POSTED transactions can be disputed');

  const updated = await updateTransactionStatus(prisma, input.transactionId, 'DISPUTED');

  await clients.sns.publish({
    topicArn:   clients.config.snsTopicArn,
    message:    JSON.stringify({ transactionId: input.transactionId }),
    attributes: { eventType: 'TRANSACTION_DISPUTED' },
  });

  return updated;
}
```

### `getTransactionById` query

```typescript
export async function getTransactionById(
  prisma: PrismaClient,
  accountId: string,
  transactionId: string
): Promise<Transaction | null> {
  const row = await prisma.transaction.findFirst({
    where: { transactionId, accountId },
  });
  return row ? mapTransaction(row) : null;
}
```

Note: uses `findFirst` with both `transactionId` and `accountId` to prevent cross-account access (even though transactionId is globally unique, the accountId check is a defense-in-depth measure).

### API handler

```
POST /accounts/:accountId/transactions/:transactionId/dispute
  1. Validate Bearer token → extract accountId from JWT, assert matches :accountId
  2. Validate :accountId is a UUID
  3. Validate :transactionId is a UUID
  4. Call serviceClient.invoke({ action: 'disputeTransaction', payload: { accountId, transactionId } })
  5. Return 200 { data: transaction }
```

Returns `200` (not 201) because the resource already exists and is being mutated.

### Error cases

| Condition | Error code | HTTP status |
|---|---|---|
| Transaction not found for this accountId | `TRANSACTION_NOT_FOUND` | 404 |
| Transaction status ≠ `POSTED` | `TRANSACTION_NOT_DISPUTABLE` | 422 |
| Missing/expired JWT | `UNAUTHORIZED` | 401 |
| JWT accountId ≠ path accountId | `FORBIDDEN` | 403 |

### Notification routing

In `src/service/notification.service.ts`, add a new case for `TRANSACTION_DISPUTED`:

```typescript
case 'TRANSACTION_DISPUTED':
  // No preference check — always send (FR-NOTIF-07)
  await sendDisputeConfirmationEmail(prisma, clients, { transactionId: event.transactionId });
  break;
```

### `sendDisputeConfirmationEmail` function

```typescript
export async function sendDisputeConfirmationEmail(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: { transactionId: string }
): Promise<void>
```

Fetches the transaction and account, renders `dispute-confirmation.hbs`, and sends via SES.

---

## Done When

- [x] `TRANSACTION_NOT_FOUND` (404) and `TRANSACTION_NOT_DISPUTABLE` (422) error codes in `src/lib/errors.ts`
- [x] `getTransactionById` + accountId cross-check in service layer for defense-in-depth
- [x] `updateTransactionStatus` added to query layer (Phase 12c will reuse)
- [x] `disputeTransaction` returns `TRANSACTION_NOT_FOUND` when no matching transaction exists
- [x] `disputeTransaction` returns `TRANSACTION_NOT_DISPUTABLE` when transaction status ≠ POSTED
- [x] `disputeTransaction` updates `status = 'DISPUTED'`, `status_updated_at = NOW()`, and publishes `TRANSACTION_DISPUTED`
- [x] `POST /accounts/:accountId/transactions/:transactionId/dispute` requires valid JWT
- [x] Endpoint returns `200` with updated transaction on success
- [x] Notification routing `TRANSACTION_DISPUTED` → `sendDisputeConfirmationEmail` already wired (Phase 12f)
- [x] Unit tests: happy path, TRANSACTION_NOT_FOUND (unknown + wrong-account), TRANSACTION_NOT_DISPUTABLE (all 5 non-POSTED statuses)
- [x] Handler tests: 200 success, 404, 422, invoke shape
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12d row updated to ✅ Complete
