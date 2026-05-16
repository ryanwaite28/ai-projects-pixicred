# Spec: Card Details & Renewal (Phase 11a)
**FR references**: FR-ACC-11, FR-ACC-12, FR-EMAIL-02
**Status**: ✅ Implemented
**Prerequisite**: Phase 3a (account creation in place), Phase 6 (approval email in place), Phase 9 (validateBearerToken in place for JWT-protected route)

---

## What

Phase 11a adds virtual credit card credentials to every `Account`: a 16-digit card number, an expiration date (3 years from creation), and a 3-digit CVV. Card details are generated at account-creation time, stored on the `accounts` table, returned in `getAccount`, and included in the approval email. A new `renewCard` service function and `POST /accounts/:accountId/card/renew` API route allow the cardholder to extend the expiry by 3 years.

---

## Why

FR-ACC-11 requires card credentials so the account feels like a real credit card product. FR-ACC-12 requires a renewal pathway. FR-EMAIL-02 is updated to include card details in the approval email so the cardholder has their card info from day one.

---

## New / Modified Files

### Schema
- `prisma/schema.prisma` — add `cardNumber String @unique`, `cardExpiry DateTime @db.Date`, `cardCvv String` to `Account` model; generate migration `add_card_fields`

### Errors
- `src/lib/errors.ts` — add `ACCOUNT_CLOSED` to `ErrorCode` union; map to HTTP `422` in `toHttpStatus`

### Types
- `src/types/index.ts` — add `cardNumber: string`, `cardExpiry: string` (ISO date string `YYYY-MM-DD`), `cardCvv: string` to `Account` interface; add `ServiceAction` union entry for `renewCard`

### Service layer — card generation
- `src/lib/card.ts` — `generateCardNumber(): string`, `generateCardExpiry(from: Date): Date`, `generateCardCvv(): string`
- `src/service/application.service.ts` — `runCreditCheck`: pass card credentials to `createAccount` when `APPROVED`
- `src/db/queries/account.queries.ts` — `createAccount` accepts and stores `cardNumber`, `cardExpiry`, `cardCvv`; `mapAccount` maps the new fields

### Service layer — renewal
- `src/service/account.service.ts` — add `renewCard(prisma, _clients, { accountId }): Promise<Account>`
- `src/db/queries/account.queries.ts` — add `updateCardExpiry(prisma, accountId, newExpiry: Date): Promise<Account>`

### API handler
- `src/handlers/api/accounts.handler.ts` — add `POST /accounts/:accountId/card/renew` route → `renewCard`

### Email
- `src/emails/approval.template.ts` — accept `cardNumber`, `cardExpiry`, `cardCvv` in context; add to plaintext
- `src/emails/templates/approval.hbs` — add card details table rows

### Service handler
- `src/handlers/service/service.handler.ts` — add `renewCard` dispatch case

---

## Behavior

### Card generation (FR-ACC-11)

```typescript
// src/lib/card.ts

export function generateCardNumber(): string {
  // 16 random digits; leading zeros preserved via zero-padded string
  const n = Math.floor(Math.random() * 1e16);
  return String(n).padStart(16, '0');
}

export function generateCardExpiry(from: Date): Date {
  // First day of the month exactly 36 months from `from`
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 36);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function generateCardCvv(): string {
  // 3 random digits; zero-padded
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
```

Generated values are passed to `createAccount` (called from `runCreditCheck` on `APPROVED`). The `cardExpiry` is stored as a DATE column; the `Account` TypeScript interface exposes it as an ISO string (`YYYY-MM-DD`). Display format (MM/YY) is a presentation concern handled in the frontend.

### Prisma schema addition

```prisma
model Account {
  // ... existing fields ...
  cardNumber  String
  cardExpiry  DateTime @db.Date
  cardCvv     String
}
```

A new migration is generated: `prisma migrate dev --name add_card_fields`.

### `getAccount` response

`cardNumber`, `cardExpiry`, `cardCvv` are included in the returned `Account` object. No masking — these are mock credentials for portfolio demonstration.

### `renewCard(prisma, _clients, { accountId }): Promise<Account>`

1. `assertUuid(accountId, 'accountId')`
2. `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
3. If `account.status === 'CLOSED'` → throw `PixiCredError('ACCOUNT_CLOSED', 'Cannot renew card on a closed account')`
4. Compute `newExpiry = generateCardExpiry(new Date())` (36 months from today)
5. `updateCardExpiry(prisma, accountId, newExpiry)`
6. Return updated `Account`

### API route: `POST /accounts/:accountId/card/renew`

- Auth-required (validates Bearer JWT, `accountId` must match token)
- No request body needed
- `201` with updated account on success
- `401`/`403` on auth failure; `404` on unknown account; `422` on closed account

### Approval email update (FR-EMAIL-02)

`buildApprovalEmail` receives `cardNumber`, `cardExpiry`, `cardCvv` from the `Account`. The template adds a "Your Card Details" section:

| Field | Value |
|---|---|
| Card Number | `{{cardNumber}}` (formatted as groups of 4: `XXXX XXXX XXXX XXXX`) |
| Expiry | `{{cardExpiry}}` (displayed as MM/YY) |
| CVV | `{{cardCvv}}` |

The `buildApprovalEmail` function signature changes to accept `account: Account` (which now carries card fields) — no new parameter required since `Account` already includes them.

---

## Done When

- [x] `ACCOUNT_CLOSED` error code added to `src/lib/errors.ts`; maps to HTTP `422`
- [x] Prisma migration runs cleanly; `accounts` table has `card_number`, `card_expiry`, `card_cvv` columns
- [x] `Account` TypeScript interface includes `cardNumber`, `cardExpiry`, `cardCvv`
- [x] `runCreditCheck` generates and stores card credentials for every approved account
- [x] `getAccount` returns card fields
- [x] `renewCard` service function extends expiry by 36 months and returns updated account
- [x] `POST /accounts/:accountId/card/renew` returns `201` with updated expiry; requires valid JWT
- [x] Approval email HTML and plaintext include card number, expiry, CVV
- [x] Unit tests for `generateCardNumber` (16 chars, digits only), `generateCardExpiry` (36-month offset), `generateCardCvv` (3 chars, digits only)
- [x] Unit tests for `renewCard` (happy path, closed account rejection)
- [x] Integration tests for `POST /accounts/:accountId/card/renew`
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `specs/01a-data-model-schema.md`, `specs/04-account-management.md`, `specs/08-notifications.md` synced
