# Spec: Payments
**FR references**: FR-PAY-01, FR-PAY-02, FR-PAY-03, FR-PAY-04, FR-PAY-05, FR-PAY-06, FR-PAY-07, FR-DUE-03, FR-DUE-04, NFR-02
**Status**: ✅ Implemented

---

## What

Phase 4 implements `postPayment` in `payment.service.ts`. A payment accepts either a positive number or the special string `"FULL"` as its amount — `"FULL"` resolves to `account.currentBalance` at the moment of processing. Idempotency is checked first; if the key already exists the original transaction is returned immediately, preserving the originally-resolved amount even if the balance has since changed (FR-PAY-07). After amount resolution and validation, the service atomically inserts a `PAYMENT` transaction, decrements `currentBalance`, and — if the new balance reaches exactly `0` — marks `PaymentDueSchedule.satisfied = true` with a timestamp (FR-PAY-03, FR-DUE-03). `satisfied` is a one-way flag: once `true` it is never reset (FR-DUE-04). A `TRANSACTION_POSTED` event is published to SNS after the commit (FR-PAY-06). The minimum payment formula (FR-PAY-05) is exported as a pure function for use by statement generation (Phase 5). The payments API handler wires `POST /accounts/:accountId/payments`.

---

## Why

FR-PAY-01–07 define the complete payment contract. FR-DUE-03 ties the payment satisfied flag to a balance reaching zero — this is the mechanism that prevents the billing lifecycle job from auto-closing accounts that have paid their balance. The `"FULL"` amount sentinel and its idempotency semantics (FR-PAY-07) are subtle and must be precisely implemented.

---

## New / Modified Files

### Service layer
- `src/service/payment.service.ts` — implements `postPayment` and exports `computeMinimumPayment`; replaces Phase 1 stub

### API handler
- `src/handlers/api/payments.handler.ts` — routes `POST /accounts/:accountId/payments` → `postPayment`; shape validation only; maps results to HTTP response envelope

### Tests
- `tests/service/payment.service.test.ts` — Vitest + Testcontainers Postgres
- `tests/handlers/payments.handler.test.ts` — integration via local Express adapter

---

## Behavior

### `postPayment(prisma, clients, input): Promise<Transaction>`

**Input** (`PostPaymentInput`):
```typescript
{
  accountId:      string;
  amount:         number | 'FULL';
  idempotencyKey: string;
}
```

**Steps — in this exact order:**

1. `assertUuid(accountId, 'accountId')`
2. `assertUuid(idempotencyKey, 'idempotencyKey')`
3. **Idempotency check** (FR-PAY-04): `getTransactionByIdempotencyKey(prisma, accountId, idempotencyKey)`
   - If found → return the existing `Transaction` immediately. Skip all remaining steps. No duplicate write, no SNS publish, no error.
   - The returned transaction records the **originally-resolved amount** — replaying a `"FULL"` key after the balance changes returns the original resolved amount (FR-PAY-07).
4. `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
5. Account status check (FR-PAY-02): `status === 'CLOSED'` → throw `ACCOUNT_NOT_ACTIVE`. Payments are allowed on `ACTIVE` and `SUSPENDED` accounts.
6. Resolve amount (FR-PAY-07):
   - `amount === 'FULL'` → `resolvedAmount = account.currentBalance`
   - otherwise → `resolvedAmount = amount`
7. Validate resolved amount:
   - `resolvedAmount <= 0` → throw `VALIDATION_ERROR` (`"FULL"` on a zero-balance account resolves to 0 and is rejected)
   - `resolvedAmount > account.currentBalance` → throw `PAYMENT_EXCEEDS_BALANCE`
8. Within a single `prisma.$transaction()` (atomic, FR-PAY-03):
   - `createTransaction(prisma, { accountId, type: 'PAYMENT', merchantName: null, amount: resolvedAmount, idempotencyKey })`
   - `newBalance = account.currentBalance - resolvedAmount`
   - `updateAccountBalance(prisma, accountId, newBalance)`
   - If `newBalance === 0` → `markPaymentDueScheduleSatisfied(prisma, accountId)` (FR-DUE-03)
9. Publish `TRANSACTION_POSTED` to `SNS_TOPIC_ARN` with `{ transactionId: transaction.transactionId }` (FR-PAY-06)
10. Return `Transaction`

**Key invariants**:
- `satisfied` is a one-way flag (FR-DUE-04): `markPaymentDueScheduleSatisfied` is a no-op when already satisfied, so a balance that drops to zero, then rises from a new charge, and drops again will not corrupt the flag.
- Minimum payment (FR-PAY-05) is informational only — `postPayment` does not enforce a minimum floor.
- The `PAYMENT` transaction has `merchantName = null`.

### `computeMinimumPayment(currentBalance: number): number`

Exported pure function (FR-PAY-05):

```typescript
export const computeMinimumPayment = (currentBalance: number): number =>
  Math.max(25, currentBalance * 0.02);
```

Imported by `statement.service.ts` (Phase 5) when computing `minimumPaymentDue`. Not enforced as a hard floor on `postPayment`.

### `src/handlers/api/payments.handler.ts`

- `POST /accounts/:accountId/payments`:
  - Shape validation: `amount` is either a positive finite number **or** the exact string `"FULL"`; `idempotencyKey` is a non-empty string
  - Calls `postPayment`; returns `201 { data: transaction }`
- On `PixiCredError`: `{ error: { code, message } }` with `toHttpStatus(code)`

The handler validates shape only. It does not resolve `"FULL"`, compute `resolvedAmount`, or inspect account balance.

---

## Exact Test Cases

### `tests/service/payment.service.test.ts`
```
test('postPayment inserts Transaction of type PAYMENT with null merchantName and returns it')
test('postPayment decrements account currentBalance by the resolved amount')
test('postPayment with numeric amount reduces balance by that exact amount')
test('postPayment with amount FULL reduces balance to zero')
test('postPayment with amount FULL resolves to currentBalance at time of processing')
test('postPayment publishes TRANSACTION_POSTED event to SNS client with transactionId')
test('postPayment throws ACCOUNT_NOT_FOUND for unknown accountId')
test('postPayment throws VALIDATION_ERROR for non-UUID accountId')
test('postPayment throws VALIDATION_ERROR for non-UUID idempotencyKey')
test('postPayment throws ACCOUNT_NOT_ACTIVE when account is CLOSED')
test('postPayment does NOT throw when account is SUSPENDED — payments allowed on suspended accounts')
test('postPayment throws VALIDATION_ERROR when numeric amount is zero')
test('postPayment throws VALIDATION_ERROR when numeric amount is negative')
test('postPayment throws VALIDATION_ERROR when amount is FULL and currentBalance is zero')
test('postPayment throws PAYMENT_EXCEEDS_BALANCE when amount exceeds currentBalance')
test('postPayment with amount exactly equal to currentBalance succeeds and sets balance to zero')
test('postPayment marks PaymentDueSchedule satisfied when payment brings balance to exactly zero')
test('postPayment stamps satisfiedAt on PaymentDueSchedule when balance reaches zero')
test('postPayment does not mark PaymentDueSchedule satisfied when balance remains above zero after payment')
test('postPayment satisfied flag is not reset when a subsequent charge raises the balance above zero')
test('postPayment is idempotent — second call with same idempotencyKey returns original transaction')
test('postPayment idempotency — replayed payment does not alter account balance')
test('postPayment idempotency — replayed payment does not create a second Transaction row in DB')
test('postPayment idempotency — replayed payment does not publish a second SNS event')
test('postPayment idempotency — replay of FULL payment returns original resolved amount even if balance has since changed')
test('postPayment idempotency check runs before account validation — returns existing transaction even if account is now CLOSED')
test('postPayment is atomic — no balance update occurs if transaction insert fails mid-flight')
test('postPayment is atomic — PaymentDueSchedule is not marked satisfied if balance update fails')
test('computeMinimumPayment returns 25 when 2% of balance is less than 25 — balance 500 yields 25')
test('computeMinimumPayment returns 2% of balance when balance is large enough — balance 2000 yields 40')
test('computeMinimumPayment returns exactly 25 at the boundary — balance 1250 yields 25')
```

### `tests/handlers/payments.handler.test.ts`
```
test('POST /accounts/:accountId/payments returns 201 with payment transaction on valid numeric amount')
test('POST /accounts/:accountId/payments returns 201 with payment transaction when amount is "FULL"')
test('POST /accounts/:accountId/payments returns 400 when amount is missing')
test('POST /accounts/:accountId/payments returns 400 when amount is zero')
test('POST /accounts/:accountId/payments returns 400 when amount is a negative number')
test('POST /accounts/:accountId/payments returns 400 when amount is a non-FULL string')
test('POST /accounts/:accountId/payments returns 400 when idempotencyKey is missing')
test('POST /accounts/:accountId/payments returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('POST /accounts/:accountId/payments returns 422 ACCOUNT_NOT_ACTIVE for CLOSED account')
test('POST /accounts/:accountId/payments returns 201 for SUSPENDED account — payments allowed')
test('POST /accounts/:accountId/payments returns 422 PAYMENT_EXCEEDS_BALANCE when amount exceeds balance')
test('POST /accounts/:accountId/payments returns 201 with original transaction on idempotent replay')
```

---

## Done When
- [x] `postPayment` accepts a positive number or the exact string `"FULL"` as `amount` (FR-PAY-01)
- [x] `postPayment` validates account is not `CLOSED`; accepts `ACTIVE` and `SUSPENDED` (FR-PAY-02)
- [x] `postPayment` idempotency check runs first — before all domain validations (FR-PAY-04, NFR-02)
- [x] `"FULL"` resolves to `account.currentBalance` at time of processing (FR-PAY-07)
- [x] Idempotent replay of `"FULL"` returns the originally-resolved amount, not the current balance (FR-PAY-07, NFR-02)
- [x] Payments accepted on `ACTIVE` and `SUSPENDED` accounts; rejected on `CLOSED` (FR-PAY-02)
- [x] `PaymentDueSchedule.satisfied` set to `true` and `satisfiedAt` stamped when `newBalance === 0` (FR-PAY-03, FR-DUE-03)
- [x] `satisfied` not reset when subsequent charges raise the balance above zero again (FR-DUE-04)
- [x] `postPayment` atomically inserts `Transaction`, updates balance, and (conditionally) marks satisfied in one DB transaction (FR-PAY-03)
- [x] `computeMinimumPayment` formula matches FR-PAY-05 exactly: `max(25, balance * 0.02)`
- [x] `postPayment` publishes `TRANSACTION_POSTED` after successful commit (FR-PAY-06)
- [x] All service unit tests pass against Testcontainers Postgres
- [x] All handler integration tests pass
- [x] Spec status updated to ✅ Implemented
- [x] `specs/02-service-layer-foundation.md` stub for `postPayment` marked replaced
- [x] IMPLEMENTATION_PLAN.md Phase 4 row marked complete
