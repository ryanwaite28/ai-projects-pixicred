# Spec: Transactions
**FR references**: FR-TXN-01, FR-TXN-02, FR-TXN-03, FR-TXN-04, FR-TXN-05, FR-TXN-06, FR-TXN-07, FR-EMAIL-03
**Status**: ✅ Implemented

---

## What

Phase 3 (part 2) implements `postCharge` and `getTransactions` in `transaction.service.ts`. `postCharge` enforces idempotency first (returning the original transaction if the key exists), then validates account existence, active status, and sufficient available credit before atomically inserting a `Transaction` row, incrementing `currentBalance`, and publishing `TRANSACTION_POSTED` to SNS. `getTransactions` returns a cursor-paginated list sorted `createdAt DESC`. The transaction email template (FR-EMAIL-03) is implemented here. The `transactions` API handler wires `POST` and `GET` routes. No payment logic is in scope — that is Phase 4.

---

## Why

FR-TXN-01–07 define the complete charge posting and retrieval contract. FR-TXN-05 (idempotency) is safety-critical: replaying a charge with the same key must be a no-op, not a double-post. FR-TXN-06 drives the downstream notification flow (FR-EMAIL-03 via Phase 6).

---

## New / Modified Files

### Service layer
- `src/service/transaction.service.ts` — implements `postCharge` and `getTransactions`; replaces Phase 1 stubs

### API handler
- `src/handlers/api/transactions.handler.ts` — routes `POST /accounts/:accountId/transactions` → `postCharge`; routes `GET /accounts/:accountId/transactions` → `getTransactions`; shape validation only; maps results to HTTP response envelope

### Email template
- `src/emails/transaction.template.ts` — `buildTransactionEmail(transaction: Transaction, account: Account): SendEmailInput` per FR-EMAIL-03; renders `src/emails/templates/transaction.hbs` via Handlebars
- `src/emails/templates/transaction.hbs` — HTML email template for transaction notifications

### Tests
- `tests/service/transaction.service.test.ts` — Vitest + Testcontainers Postgres
- `tests/handlers/transactions.handler.test.ts` — integration via local Express adapter
- `tests/emails/transaction.template.test.ts`

---

## Behavior

### `postCharge(prisma, clients, input): Promise<Transaction>`

**Input** (`PostChargeInput`):
```typescript
{
  accountId:      string;
  merchantName:   string;
  amount:         number;
  idempotencyKey: string;
}
```

**Steps — in this exact order:**

1. `assertUuid(accountId, 'accountId')`
2. `assertUuid(idempotencyKey, 'idempotencyKey')`
3. **Idempotency check** (FR-TXN-05): `getTransactionByIdempotencyKey(prisma, accountId, idempotencyKey)`
   - If found → return the existing `Transaction` immediately. Skip all remaining steps. No duplicate write, no SNS publish, no error.
4. `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
5. `account.status !== 'ACTIVE'` → throw `ACCOUNT_NOT_ACTIVE` (FR-TXN-02)
6. `amount <= 0` → throw `VALIDATION_ERROR` — zero and negative charges are not meaningful transactions
7. `amount > account.availableCredit` → throw `INSUFFICIENT_CREDIT` (FR-TXN-04)
8. Within a single `prisma.$transaction()` (atomic, FR-TXN-03):
   - `createTransaction(prisma, { accountId, type: 'CHARGE', merchantName, amount, idempotencyKey })`
   - `updateAccountBalance(prisma, accountId, account.currentBalance + amount)`
9. Publish `TRANSACTION_POSTED` to `SNS_TOPIC_ARN` with `{ transactionId: transaction.transactionId }` (FR-TXN-06)
10. Return `Transaction`

**Idempotency contract**: the idempotency check (step 3) runs before all domain validations. If the key already exists, the original transaction is returned regardless of the account's current state (status, balance). The caller receives a success result, not an error.

### `getTransactions(prisma, _clients, input): Promise<Transaction[]>`

**Input** (`GetTransactionsInput`):
```typescript
{
  accountId: string;
  cursor?:   string;  // transaction_id UUID of the last row received
  limit?:    number;  // default 20, max 100
}
```

- `assertUuid(accountId, 'accountId')`
- If `cursor` provided: `assertUuid(cursor, 'cursor')`
- If `limit > 100`: clamp to 100
- `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
- `getTransactionsByAccountId(prisma, { accountId, cursor, limit: limit ?? 20 })`
- Return `Transaction[]` sorted `createdAt DESC` (FR-TXN-07)

**Cursor pagination**: the cursor is a `transactionId`. The query returns rows whose `created_at` is strictly less than the `created_at` of the cursor row. See `specs/01-data-model.md` for the query definition.

### `src/emails/transaction.template.ts`

```typescript
export function buildTransactionEmail(transaction: Transaction, account: Account): SendEmailInput
```

Fields (FR-EMAIL-03): `to = account.holderEmail`, `from = SES_FROM_EMAIL env var`, subject references merchant name and amount, body includes `transaction.merchantName`, `transaction.amount`, new balance (`account.currentBalance` post-charge), available credit (`account.availableCredit` post-charge). Body HTML produced by rendering `src/emails/templates/transaction.hbs` via Handlebars.

The `account` argument is the post-charge account state. The template performs no arithmetic — it displays the values it receives.

### `src/handlers/api/transactions.handler.ts`

- `POST /accounts/:accountId/transactions`:
  - Shape validation: `merchantName` is a non-empty string, `amount` is a finite number, `idempotencyKey` is a non-empty string
  - Calls `postCharge`; returns `201 { data: transaction }`
- `GET /accounts/:accountId/transactions`:
  - Shape validation: `cursor` (optional query param) is a non-empty string if provided; `limit` parsed as integer if provided
  - Calls `getTransactions`; returns `200 { data: transactions[] }`
- On `PixiCredError`: `{ error: { code, message } }` with `toHttpStatus(code)`

---

## Exact Test Cases

### `tests/service/transaction.service.test.ts`
```
test('postCharge inserts Transaction of type CHARGE and returns it')
test('postCharge increments account currentBalance by the charge amount')
test('postCharge decrements account availableCredit by the charge amount')
test('postCharge publishes TRANSACTION_POSTED event to SNS client with transactionId')
test('postCharge throws ACCOUNT_NOT_FOUND for unknown accountId')
test('postCharge throws VALIDATION_ERROR for non-UUID accountId')
test('postCharge throws VALIDATION_ERROR for non-UUID idempotencyKey')
test('postCharge throws ACCOUNT_NOT_ACTIVE when account is SUSPENDED')
test('postCharge throws ACCOUNT_NOT_ACTIVE when account is CLOSED')
test('postCharge throws VALIDATION_ERROR when amount is zero')
test('postCharge throws VALIDATION_ERROR when amount is negative')
test('postCharge throws INSUFFICIENT_CREDIT when amount exceeds availableCredit')
test('postCharge with amount exactly equal to availableCredit succeeds and leaves availableCredit at zero')
test('postCharge is idempotent — second call with same idempotencyKey returns original transaction')
test('postCharge idempotency — replayed charge does not create a second Transaction row in DB')
test('postCharge idempotency — replayed charge does not alter account balance')
test('postCharge idempotency — replayed charge does not publish a second SNS event')
test('postCharge idempotency check runs before account validation — returns existing transaction even if account is now CLOSED')
test('postCharge is atomic — no balance update occurs if transaction insert fails mid-flight')
test('getTransactions returns transactions for accountId sorted by createdAt descending')
test('getTransactions returns empty array when account has no transactions')
test('getTransactions returns at most 20 transactions by default')
test('getTransactions respects explicit limit parameter')
test('getTransactions clamps limit to 100 when limit exceeds 100')
test('getTransactions cursor — returns only transactions older than cursor row')
test('getTransactions cursor — returns empty array when cursor is the oldest transaction')
test('getTransactions throws ACCOUNT_NOT_FOUND for unknown accountId')
test('getTransactions throws VALIDATION_ERROR for non-UUID accountId')
test('getTransactions throws VALIDATION_ERROR for non-UUID cursor')
```

### `tests/emails/transaction.template.test.ts`
```
test('buildTransactionEmail sets to field to account holderEmail')
test('buildTransactionEmail subject includes merchant name')
test('buildTransactionEmail body includes transaction amount')
test('buildTransactionEmail body includes new account balance')
test('buildTransactionEmail body includes available credit after charge')
test('buildTransactionEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/handlers/transactions.handler.test.ts`
```
test('POST /accounts/:accountId/transactions returns 201 with transaction on valid input')
test('POST /accounts/:accountId/transactions returns 400 when merchantName is missing')
test('POST /accounts/:accountId/transactions returns 400 when amount is not a number')
test('POST /accounts/:accountId/transactions returns 400 when idempotencyKey is missing')
test('POST /accounts/:accountId/transactions returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('POST /accounts/:accountId/transactions returns 422 ACCOUNT_NOT_ACTIVE for non-active account')
test('POST /accounts/:accountId/transactions returns 422 INSUFFICIENT_CREDIT when amount exceeds available credit')
test('POST /accounts/:accountId/transactions returns 201 with original transaction on idempotent replay')
test('GET /accounts/:accountId/transactions returns 200 with transactions array')
test('GET /accounts/:accountId/transactions returns 200 with empty array when no transactions')
test('GET /accounts/:accountId/transactions passes cursor query param to service')
test('GET /accounts/:accountId/transactions passes limit query param to service as integer')
test('GET /accounts/:accountId/transactions returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
```

---

## Done When
- [x] `postCharge` idempotency check runs first — before all domain validations
- [x] `postCharge` atomically inserts `Transaction` and updates balance in one DB transaction
- [x] `postCharge` publishes `TRANSACTION_POSTED` event after successful commit
- [x] Idempotent replay returns original transaction, produces zero DB writes, produces zero SNS publishes
- [x] `getTransactions` defaults to limit 20, clamps at 100, supports cursor pagination
- [x] Transaction email template includes all fields required by FR-EMAIL-03
- [x] All service unit tests pass against Testcontainers Postgres
- [x] All handler integration tests pass
- [x] Spec status updated to ✅ Implemented
- [x] `specs/02-service-layer-foundation.md` stubs for `postCharge` and `getTransactions` marked replaced
- [x] IMPLEMENTATION_PLAN.md Phase 3 (part 2) row marked complete
