# Spec: Merchant Charge (Phase 11b)
**FR references**: FR-TXN-08
**Status**: ✅ Implemented
**Prerequisite**: Phase 3b (postCharge in place), Phase 11a (card fields on Account)

---

## What

Phase 11b adds a public `POST /merchant/charge` endpoint that allows an unauthenticated caller (the merchant demo page) to post a charge to an account using card credentials rather than a JWT. The service layer resolves the account by card number, validates CVV and expiry, then delegates to the existing `postCharge` service function for idempotency, balance deduction, and SNS publishing — no duplicate logic.

---

## Why

FR-TXN-08 requires a public merchant-facing charge pathway so the portfolio demo page can simulate a purchase without requiring the cardholder to be logged in.

---

## New / Modified Files

### Types
- `src/types/index.ts` — add `PostMerchantChargeInput` interface; add `postMerchantCharge` entry to `ServiceAction` union

### Errors
- `src/lib/errors.ts` — add `CARD_NOT_FOUND`, `INVALID_CARD_CVV`, `CARD_EXPIRED` to `PixiCredErrorCode` union and `toHttpStatus` map

### Query layer
- `src/db/queries/account.queries.ts` — add `getAccountByCardNumber(prisma, cardNumber): Promise<Account | null>`

### Service layer
- `src/service/transaction.service.ts` — add `postMerchantCharge(prisma, clients, input): Promise<Transaction>`

### API handler
- `src/handlers/api/merchant.handler.ts` — NEW file; routes `POST /merchant/charge` → `postMerchantCharge`; no auth middleware; no call to `getConfig()` (JWT not needed)

### Service handler
- `src/handlers/service/service.handler.ts` — add `postMerchantCharge` dispatch case

### Infrastructure
- `infra/terraform/envs/dev/main.tf` — add `module "api_merchant"` Lambda block; add `merchant` integration entry to `module "api_gateway"` for `POST /merchant/charge`
- `infra/terraform/envs/prod/main.tf` — same additions as dev

### CI/CD
- `.github/workflows/deploy.yml` (or equivalent) — add `api-merchant` to the Lambda bundle + upload step (same pattern as `api-transactions`)

---

## Behavior

### `PostMerchantChargeInput`

```typescript
export interface PostMerchantChargeInput {
  cardNumber:     string;
  cardCvv:        string;
  merchantName:   string;
  amount:         number;
  idempotencyKey: string;
}
```

### Prisma schema addition

`cardNumber` must be `@unique` so it can be used as a lookup key. This constraint is added as part of Phase 11a (card fields migration). If the unique constraint was not included in Phase 11a, add it here with a separate migration:

```prisma
model Account {
  // ...
  cardNumber  String   @unique
  cardExpiry  DateTime @db.Date
  cardCvv     String
}
```

Migration (only if not already run in Phase 11a): `prisma migrate dev --name add_card_number_unique`

### `getAccountByCardNumber(prisma, cardNumber): Promise<Account | null>`

```typescript
// src/db/queries/account.queries.ts
export async function getAccountByCardNumber(
  prisma: PrismaClient,
  cardNumber: string,
): Promise<Account | null> {
  const row = await prisma.account.findUnique({ where: { cardNumber } });
  return row ? mapAccount(row) : null;
}
```

### `postMerchantCharge(prisma, clients, input): Promise<Transaction>`

```typescript
// src/service/transaction.service.ts
export async function postMerchantCharge(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: PostMerchantChargeInput,
): Promise<Transaction>
```

**Why it cannot follow the `postCharge` idempotency-first ordering**: `getTransactionByIdempotencyKey` is scoped by `(accountId, idempotencyKey)`. The merchant has only a `cardNumber` at call time — `accountId` is unknown until the card lookup completes. Therefore the card lookup must happen first so the `accountId` is available for the idempotency check.

Steps:

1. `assertUuid(input.idempotencyKey, 'idempotencyKey')`
2. Validate `cardNumber` matches `/^\d{16}$/` → throw `VALIDATION_ERROR('cardNumber must be a 16-digit string')`
3. Validate `cardCvv` matches `/^\d{3}$/` → throw `VALIDATION_ERROR('cardCvv must be a 3-digit string')`
4. Validate `merchantName` is a non-empty string → throw `VALIDATION_ERROR('merchantName is required')`
5. Validate `amount > 0` → throw `VALIDATION_ERROR('amount must be positive')`
6. `getAccountByCardNumber(prisma, input.cardNumber)` → null → throw `PixiCredError('CARD_NOT_FOUND', 'No account found for the provided card number')`
7. CVV check: `account.cardCvv !== input.cardCvv` → throw `PixiCredError('INVALID_CARD_CVV', 'Card CVV does not match')`
8. Expiry check: `new Date(account.cardExpiry) <= new Date()` → throw `PixiCredError('CARD_EXPIRED', 'Card has expired')`
9. Delegate: `return postCharge(prisma, clients, { accountId: account.accountId, merchantName: input.merchantName, amount: input.amount, idempotencyKey: input.idempotencyKey })`

`postCharge` handles idempotency (returning the existing transaction immediately if the key is already seen), status check, credit check, atomic DB insert + balance update, and SNS publish. No duplication.

> **Note on double account fetch**: `postCharge` re-fetches the account via `getAccountById`. This is a minor inefficiency (two DB round-trips) but avoids coupling `postMerchantCharge` to the internals of `postCharge`. Acceptable for this use case.

### Error codes added to `src/lib/errors.ts`

| Code | HTTP status | Condition |
|---|---|---|
| `CARD_NOT_FOUND` | 404 | No account found for the provided card number |
| `INVALID_CARD_CVV` | 422 | CVV does not match account record |
| `CARD_EXPIRED` | 422 | Card expiry date is in the past |

Errors thrown by the delegated `postCharge` call (`ACCOUNT_NOT_ACTIVE`, `INSUFFICIENT_CREDIT`, `VALIDATION_ERROR`) bubble up naturally and are already mapped in `toHttpStatus`.

### API handler: `POST /merchant/charge`

**File**: `src/handlers/api/merchant.handler.ts`

- **No auth middleware** — no call to `validateBearerToken`, no call to `getConfig()`
- **Request body** (JSON):
  ```json
  {
    "cardNumber": "1234567890123456",
    "cardCvv": "123",
    "merchantName": "Acme Coffee",
    "amount": 15.99,
    "idempotencyKey": "<uuid>"
  }
  ```
- Handler validates that all five fields are present and non-empty; `amount` is a finite positive number; then invokes `postMerchantCharge` via service client
- **201** with `{ data: transaction }` on success
- **404** on `CARD_NOT_FOUND`; **422** on CVV/expiry/credit/validation errors; **500** on unexpected errors

### Terraform — `dev/main.tf` and `prod/main.tf`

Add the merchant Lambda module (same pattern as `api_transactions`):

```hcl
module "api_merchant" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-merchant"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-merchant/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}
```

Add to `module "api_gateway"` integrations map:

```hcl
merchant = {
  lambda_arn = module.api_merchant.function_arn
  invoke_arn = module.api_merchant.invoke_arn
  routes = [
    { method = "POST", path = "/merchant/charge" },
  ]
}
```

> `local.service_invoke_policy` includes `secretsmanager:GetSecretValue`, which the merchant handler will not use (no JWT validation). Reusing it is harmless; a tighter `lambda:InvokeFunction`-only policy is an option but adds Terraform complexity for minimal gain.

---

## Done When

- [x] `cardNumber @unique` constraint in place (Phase 11a or this migration)
- [x] `getAccountByCardNumber` query returns `Account | null`
- [x] `postMerchantCharge` resolves account by card number, validates CVV and expiry, then delegates to `postCharge`
- [x] Idempotency: same `idempotencyKey` returns the original transaction (via `postCharge` idempotency path)
- [x] `CARD_NOT_FOUND`, `INVALID_CARD_CVV`, `CARD_EXPIRED` error codes added and mapped to correct HTTP status
- [x] `POST /merchant/charge` returns `201` with transaction on success; no JWT required
- [x] `POST /merchant/charge` returns `404` for unknown card; `422` for CVV/expiry/validation failures
- [x] `module "api_merchant"` Lambda + API Gateway integration added to `dev/main.tf` and `prod/main.tf`
- [x] `api-merchant` bundle step added to `esbuild.config.ts` (bundled alongside all other Lambda entry points)
- [x] Unit tests for `postMerchantCharge`: happy path, card not found, CVV mismatch, expired card, idempotency (returns existing transaction)
- [x] Integration test for `POST /merchant/charge` (happy path + CVV failure)
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `specs/05-transactions.md`, `specs/01b-data-model-queries.md` synced
