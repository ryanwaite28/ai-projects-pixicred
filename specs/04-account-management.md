# Spec: Account Management
**FR references**: FR-ACC-02, FR-ACC-03, FR-ACC-04, FR-ACC-05, FR-ACC-09, FR-ACC-10, FR-EMAIL-09
**Status**: 🔄 In Progress

---

## What

Phase 3 (part 1) implements the two remaining account service actions — `getAccount` and `closeAccount` — and the `accounts` API handler. `getAccount` retrieves an account by ID and derives `availableCredit` from `creditLimit - currentBalance` (never stored). `closeAccount` validates the account exists and is not already closed, transitions the status to `CLOSED`, stamps `closedAt`, and publishes an SNS event (`ACCOUNT_USER_CLOSED` or `ACCOUNT_AUTO_CLOSED`) so the notification consumer (Phase 6) can deliver the appropriate email. The user-close email template is implemented here. The `DELETE /accounts/:accountId` route is wired into the API handler. The `AUTO_NONPAYMENT` close path is fully implemented in this phase even though it is only triggered by the billing lifecycle job (Phase 4.5) — the two paths share one function and diverge only in the event type published.

---

## Why

FR-ACC-04 requires account retrieval; FR-ACC-05 defines status transitions; FR-ACC-09 specifies user-initiated close semantics; FR-ACC-10 requires that a holder may reapply after closure. FR-EMAIL-09 requires a confirmation email on user-requested close. Building the full `closeAccount` function here — including the `AUTO_NONPAYMENT` branch — avoids splitting a single service function across two phase specs.

---

## New / Modified Files

### Service layer
- `src/service/account.service.ts` — implements `getAccount` and `closeAccount`; replaces Phase 1 stubs

### API handler
- `src/handlers/api/accounts.handler.ts` — routes `GET /accounts/:accountId` → `getAccount`; routes `DELETE /accounts/:accountId` → `closeAccount` with `reason: 'USER_REQUESTED'`; shape validation only; maps results to HTTP response envelope

### Email template
- `src/emails/user-close.template.ts` — `buildUserCloseEmail(account: Account): SendEmailInput` per FR-EMAIL-09; renders `src/emails/templates/user-close.hbs` via Handlebars
- `src/emails/templates/user-close.hbs` — HTML email template for user-requested close confirmation

### Tests
- `tests/service/account.service.test.ts` — Vitest + Testcontainers Postgres
- `tests/handlers/accounts.handler.test.ts` — integration via local Express adapter
- `tests/emails/user-close.template.test.ts`

---

## Behavior

### `getAccount(prisma, _clients, { accountId }): Promise<Account>`

- `assertUuid(accountId, 'accountId')`
- `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
- `availableCredit` is computed and attached before returning: `Number(account.creditLimit) - Number(account.currentBalance)` (FR-ACC-03); it is never stored in the database (Prisma `Decimal` fields are cast to `number` by the query layer)
- Return `Account`

### `closeAccount(prisma, clients, { accountId, reason }): Promise<Account>`

- `assertUuid(accountId, 'accountId')`
- `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
- If `account.status === 'CLOSED'` → throw `PixiCredError('ACCOUNT_ALREADY_CLOSED', 'Account is already closed')`
- `updateAccountStatus(prisma, accountId, 'CLOSED', reason)` — sets `status = 'CLOSED'`, `close_reason = reason`, `closed_at = NOW()`
- Publish to SNS:
  - `reason === 'USER_REQUESTED'` → event type `ACCOUNT_USER_CLOSED` with `{ accountId }`
  - `reason === 'AUTO_NONPAYMENT'` → event type `ACCOUNT_AUTO_CLOSED` with `{ accountId }`
- The notification consumer (Phase 6) calls `sendUserCloseEmail` / `sendAutoCloseEmail` upon receiving the event. `closeAccount` does NOT call email functions directly.
- Return updated `Account`

**Status transition rules** (FR-ACC-05):
- `ACTIVE → CLOSED` ✅
- `SUSPENDED → CLOSED` ✅
- `CLOSED → CLOSED` ❌ throws `ACCOUNT_ALREADY_CLOSED`

Note: `SUSPENDED` status is set administratively and is out of scope for Phase 3 API routes. The service function handles `SUSPENDED → CLOSED` correctly because the status check only guards against `CLOSED → CLOSED`.

### `src/emails/user-close.template.ts`

```typescript
export function buildUserCloseEmail(account: Account): SendEmailInput
```

Fields (FR-EMAIL-09): `to = account.holderEmail`, `from = SES_FROM_EMAIL env var`, subject confirms account closure, body confirms the account was closed at the holder's request and includes instructions to reapply for a new account. Body HTML produced by rendering `src/emails/templates/user-close.hbs` via Handlebars.

### `src/handlers/api/accounts.handler.ts`

- `GET /accounts/:accountId` — `accountId` non-empty string; calls `getAccount`; returns `200 { data: account }`
- `DELETE /accounts/:accountId` — `accountId` non-empty string; calls `closeAccount({ accountId, reason: 'USER_REQUESTED' })`; returns `200 { data: account }`
- On `PixiCredError`: returns `{ error: { code, message } }` with `toHttpStatus(code)`

**No business logic in the handler**: the handler does not check account status, does not decide whether to send an email. It passes `reason: 'USER_REQUESTED'` as a fixed literal — that is input shaping, not a domain rule.

---

## Exact Test Cases

### `tests/service/account.service.test.ts`
```
test('getAccount returns Account with all fields for a valid accountId')
test('getAccount derives availableCredit as creditLimit minus currentBalance')
test('getAccount throws ACCOUNT_NOT_FOUND for unknown accountId')
test('getAccount throws VALIDATION_ERROR for non-UUID accountId')
test('closeAccount USER_REQUESTED transitions ACTIVE account to CLOSED')
test('closeAccount USER_REQUESTED transitions SUSPENDED account to CLOSED')
test('closeAccount USER_REQUESTED stamps closedAt on the returned Account')
test('closeAccount USER_REQUESTED sets closeReason to USER_REQUESTED')
test('closeAccount USER_REQUESTED throws ACCOUNT_ALREADY_CLOSED when account is already CLOSED')
test('closeAccount USER_REQUESTED throws ACCOUNT_NOT_FOUND for unknown accountId')
test('closeAccount USER_REQUESTED throws VALIDATION_ERROR for non-UUID accountId')
test('closeAccount USER_REQUESTED publishes ACCOUNT_USER_CLOSED event to SNS client')
test('closeAccount USER_REQUESTED does not publish ACCOUNT_AUTO_CLOSED event')
test('closeAccount AUTO_NONPAYMENT transitions ACTIVE account to CLOSED')
test('closeAccount AUTO_NONPAYMENT transitions SUSPENDED account to CLOSED')
test('closeAccount AUTO_NONPAYMENT sets closeReason to AUTO_NONPAYMENT')
test('closeAccount AUTO_NONPAYMENT publishes ACCOUNT_AUTO_CLOSED event to SNS client')
test('closeAccount AUTO_NONPAYMENT does not publish ACCOUNT_USER_CLOSED event')
test('closeAccount AUTO_NONPAYMENT throws ACCOUNT_ALREADY_CLOSED when account is already CLOSED')
test('reapplication is possible after account is CLOSED — getActiveApplicationOrAccountByEmail returns null')
```

### `tests/emails/user-close.template.test.ts`
```
test('buildUserCloseEmail sets to field to account holderEmail')
test('buildUserCloseEmail subject confirms account closure')
test('buildUserCloseEmail body confirms closure was at holder request')
test('buildUserCloseEmail body includes instructions to reapply')
test('buildUserCloseEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/handlers/accounts.handler.test.ts`
```
test('GET /accounts/:accountId returns 200 with account data including availableCredit')
test('GET /accounts/:accountId returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('GET /accounts/:accountId returns 400 VALIDATION_ERROR for non-UUID accountId')
test('DELETE /accounts/:accountId returns 200 with closed account on ACTIVE account')
test('DELETE /accounts/:accountId returns 200 with closed account on SUSPENDED account')
test('DELETE /accounts/:accountId returns 422 ACCOUNT_ALREADY_CLOSED when account is already CLOSED')
test('DELETE /accounts/:accountId returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('DELETE /accounts/:accountId always passes reason USER_REQUESTED to service — never AUTO_NONPAYMENT')
```

---

## Done When
- [ ] `getAccount` derives `availableCredit` correctly and never reads it from DB
- [ ] `closeAccount` handles all three status transitions: `ACTIVE → CLOSED`, `SUSPENDED → CLOSED`, `CLOSED → CLOSED` (error)
- [ ] `closeAccount` publishes correct SNS event type for each `reason`
- [ ] `closeAccount` does not call any email function directly
- [ ] User-close email template includes all fields required by FR-EMAIL-09
- [ ] Handler passes `reason: 'USER_REQUESTED'` as a fixed literal — no conditional logic in handler
- [ ] Reapplication test confirms `getActiveApplicationOrAccountByEmail` returns null after close
- [ ] All service unit tests pass against Testcontainers Postgres
- [ ] All handler integration tests pass
- [ ] Spec status updated to ✅ Implemented
- [ ] `specs/02-service-layer-foundation.md` stubs for `getAccount` and `closeAccount` marked replaced
- [ ] IMPLEMENTATION_PLAN.md Phase 3 (part 1) row marked complete
