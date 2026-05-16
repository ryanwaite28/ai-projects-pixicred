# Spec: Transaction Charge Behavior Update — PROCESSING vs DENIED (Phase 12b)
**FR references**: FR-TXN-02, FR-TXN-03, FR-TXN-04, FR-TXN-06, FR-TXN-08
**Status**: ✅ Implemented
**Prerequisite**: Phase 12a ✅ (status column exists), Phase 11b ✅ (postMerchantCharge in place)

---

## What

Phase 12b changes how charge transactions behave when the amount exceeds available credit. Previously, `postCharge` and `postMerchantCharge` threw `INSUFFICIENT_CREDIT` (returning a 422 error). Now they **create a `DENIED` transaction record** instead — no balance change, no error thrown. The published SNS event changes from `TRANSACTION_POSTED` to `TRANSACTION_CREATED` for all charge transactions (both PROCESSING and DENIED). Payment transactions are unaffected.

---

## Why

FR-TXN-02 through FR-TXN-04 require that insufficient-credit charges produce a `DENIED` transaction record rather than an error response, giving cardholders a complete audit trail and denial notifications. FR-TXN-06 requires `TRANSACTION_CREATED` to be published for new charge transactions so the notification service can send the appropriate email (FR-EMAIL-11) for both PROCESSING and DENIED outcomes.

---

## New / Modified Files

### Service layer
- `src/service/transaction.service.ts` — update `postCharge` and `postMerchantCharge`; change SNS event from `TRANSACTION_POSTED` to `TRANSACTION_CREATED` for charge creation

### Errors
- `src/lib/errors.ts` — remove `INSUFFICIENT_CREDIT` from the `toHttpStatus` map (it is no longer thrown by the charge path; keep the type entry for future use or remove entirely if no other caller uses it)

### Tests
- `tests/service/transaction.service.test.ts` — update: INSUFFICIENT_CREDIT tests → now assert DENIED transaction returned; add assertions for `TRANSACTION_CREATED` event (not `TRANSACTION_POSTED`) on charge creation
- `tests/handlers/merchant.handler.test.ts` — update: 422 INSUFFICIENT_CREDIT test → now asserts 201 with DENIED transaction

---

## Behavior

### Updated `postCharge` logic

```
1. assertUuid(idempotencyKey, 'idempotencyKey')
2. Validate account exists and is ACTIVE
3. Validate amount > 0
4. Check idempotency: existing = getTransactionByIdempotencyKey(prisma, accountId, idempotencyKey)
   if (existing) return existing   ← short-circuit regardless of status
5. if (amount > account.availableCredit):
     tx = createTransaction(prisma, { accountId, type: 'CHARGE', merchantName, amount, idempotencyKey, status: 'DENIED', statusUpdatedAt: now })
     publish SNS: TRANSACTION_CREATED
     return tx
   else:
     within prisma.$transaction():
       tx = createTransaction(..., status: 'PROCESSING', statusUpdatedAt: now)
       incrementBalance(prisma, accountId, amount)
     publish SNS: TRANSACTION_CREATED
     return tx
```

**Key differences from current behavior:**
- No `PixiCredError('INSUFFICIENT_CREDIT', ...)` thrown
- Both paths (PROCESSING and DENIED) publish `TRANSACTION_CREATED` (not `TRANSACTION_POSTED`)
- DENIED transaction is created without touching `currentBalance`
- Idempotency check returns existing DENIED transaction without re-evaluating credit

### Updated `postMerchantCharge` logic

`postMerchantCharge` delegates to `postCharge` after card validation. No changes needed in the delegation flow — the DENIED/PROCESSING behavior is entirely within `postCharge`. The merchant handler returns the transaction (which may be DENIED) with HTTP 201.

### SNS event naming

| Path | Old event | New event |
|---|---|---|
| `postCharge` (sufficient credit) | `TRANSACTION_POSTED` | `TRANSACTION_CREATED` |
| `postCharge` (insufficient credit) | error thrown | `TRANSACTION_CREATED` (DENIED tx) |
| `postMerchantCharge` (sufficient) | `TRANSACTION_POSTED` | `TRANSACTION_CREATED` |
| `postMerchantCharge` (insufficient) | error thrown | `TRANSACTION_CREATED` (DENIED tx) |
| `postPayment` | `TRANSACTION_POSTED` | `TRANSACTION_POSTED` (**unchanged**) |

### Idempotency behavior for DENIED transactions

If a caller replays an `idempotencyKey` that was used for a DENIED transaction, `postCharge` returns the original DENIED transaction immediately (step 4 short-circuit). The caller's new available credit is irrelevant — the key is consumed.

### API handler response

Both `POST /accounts/:accountId/transactions` and `POST /merchant/charge` return `201` regardless of whether the transaction is `PROCESSING` or `DENIED`. The caller can inspect the `status` field in the response to know the outcome.

---

## Done When

- [x] `postCharge`: insufficient credit creates `DENIED` transaction, publishes `TRANSACTION_CREATED`, returns the transaction (no error thrown)
- [x] `postCharge`: sufficient credit creates `PROCESSING` transaction, publishes `TRANSACTION_CREATED`
- [x] `postMerchantCharge` inherits the new behavior via delegation to `postCharge`
- [x] `postPayment` still publishes `TRANSACTION_POSTED` (unchanged)
- [x] Idempotency returns existing `DENIED` transaction on replay
- [x] SNS event attribute carries `eventType: 'TRANSACTION_CREATED'` for all charge creation paths
- [x] Existing unit tests for insufficient-credit path updated: assert DENIED transaction returned, no error thrown
- [x] New unit test: replay of DENIED idempotency key returns same DENIED transaction
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12b row updated to ✅ Complete
- [x] `specs/15a-transaction-status-schema.md` synced if any behavior diverges from Phase 12a assumptions
