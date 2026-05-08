# Spec: Backend Portal Authentication (Phase 9)
**FR references**: FR-AUTH-01, FR-AUTH-02, FR-AUTH-03, FR-AUTH-04, FR-AUTH-05, FR-AUTH-06, FR-AUTH-07, FR-AUTH-08
**Status**: 🔄 In Progress
**Prerequisite**: Phase 8 (Secrets Manager live with `JWT_SECRET`; service layer complete)

---

## What

Phase 9 adds the portal authentication layer to the backend. This includes: a new `portal_accounts` Prisma model and migration; the `auth.queries.ts` query file; `auth.service.ts` with `registerPortalAccount` and `loginPortalAccount` service functions; and `auth.handler.ts` for the `POST /auth/register` and `POST /auth/login` API routes. JWT signing uses HS256 with a 24-hour expiry. Passwords are hashed with bcrypt cost 12.

---

## Why

FR-AUTH-01 through FR-AUTH-08 require a secure, stateless authentication mechanism for the Angular portal. This layer is backend-only; the Angular SPA is implemented in Phase 10.

---

## New / Modified Files

- `prisma/schema.prisma` — add `PortalAccount` model (new migration: `add_portal_accounts`)
- `src/db/queries/auth.queries.ts` — query functions for `portal_accounts`
- `src/service/auth.service.ts` — `registerPortalAccount` and `loginPortalAccount`
- `src/handlers/api/auth.handler.ts` — `POST /auth/register` and `POST /auth/login`
- `tests/service/auth.service.test.ts`
- `tests/db/auth.queries.test.ts`

---

## Behavior

### `prisma/schema.prisma` — `PortalAccount` model addition

```prisma
model PortalAccount {
  accountId    String   @id @map("account_id") @db.Uuid
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  account Account @relation(fields: [accountId], references: [accountId])

  @@map("portal_accounts")
}
```

Add the back-relation to the `Account` model: `portalAccount PortalAccount?`

### `src/db/queries/auth.queries.ts`

```typescript
export async function createPortalAccount(
  prisma: PrismaClient,
  accountId: string,
  email: string,
  passwordHash: string
): Promise<void>

export async function getPortalAccountByEmail(
  prisma: PrismaClient, email: string
): Promise<{ accountId: string; passwordHash: string } | null>

export async function portalAccountExistsForAccountId(
  prisma: PrismaClient, accountId: string
): Promise<boolean>
```

### `src/service/auth.service.ts` — `registerPortalAccount`

Input: `{ email: string; accountId: string; password: string }`

Steps:
1. `getAccountById(prisma, accountId)` — throw `ACCOUNT_NOT_FOUND` (404) if null
2. Assert account's linked application has `status = 'APPROVED'` — throw `PORTAL_ACCOUNT_NOT_ELIGIBLE` (422) if not
3. `portalAccountExistsForAccountId(prisma, accountId)` — throw `PORTAL_ACCOUNT_EXISTS` (409) if true
4. `bcrypt.hash(password, 12)` → `passwordHash`
5. `createPortalAccount(prisma, accountId, email, passwordHash)`
6. Return `{ accountId }`

### `src/service/auth.service.ts` — `loginPortalAccount`

Input: `{ email: string; password: string }`

Steps:
1. `getPortalAccountByEmail(prisma, email)` — throw `INVALID_CREDENTIALS` (401) if null
2. `bcrypt.compare(password, passwordHash)` — throw `INVALID_CREDENTIALS` (401) if false
3. Sign JWT: `jwt.sign({ accountId, email }, JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' })`
4. Return `{ token, accountId }`

`JWT_SECRET` is read from `process.env.JWT_SECRET` (injected from Secrets Manager in non-local environments; set directly in `.env` locally).

### `src/handlers/api/auth.handler.ts`

Handler shape: `POST /auth/register` and `POST /auth/login`. No JWT required on these routes (FR-AUTH-05).

`POST /auth/register`:
- Extract `{ email, accountId, password }` from body
- Shape validation: all three fields present and non-empty; `password` minimum 8 characters
- Call `serviceClient.invoke({ action: 'registerPortalAccount', payload: { email, accountId, password } })`
- Return `201 { data: { accountId } }` on success

`POST /auth/login`:
- Extract `{ email, password }` from body
- Shape validation: both fields present
- Call `serviceClient.invoke({ action: 'loginPortalAccount', payload: { email, password } })`
- Return `200 { data: { token, accountId } }` on success

---

## Exact Test Cases

### `tests/db/auth.queries.test.ts`
```
test('createPortalAccount inserts row with hashed password and returns void')
test('getPortalAccountByEmail returns null when email not found')
test('getPortalAccountByEmail returns accountId and passwordHash for matching email')
test('portalAccountExistsForAccountId returns false when no portal account exists')
test('portalAccountExistsForAccountId returns true when portal account exists')
```

### `tests/service/auth.service.test.ts`
```
test('registerPortalAccount throws ACCOUNT_NOT_FOUND when accountId does not exist')
test('registerPortalAccount throws PORTAL_ACCOUNT_NOT_ELIGIBLE when application is not APPROVED')
test('registerPortalAccount throws PORTAL_ACCOUNT_EXISTS when portal account already exists for accountId')
test('registerPortalAccount creates portal account and returns accountId on success')
test('registerPortalAccount stores bcrypt hash — plaintext password is not stored')
test('loginPortalAccount throws INVALID_CREDENTIALS when email not found')
test('loginPortalAccount throws INVALID_CREDENTIALS when password does not match hash')
test('loginPortalAccount returns signed JWT with accountId and email in payload on success')
test('loginPortalAccount JWT payload contains exp approximately 24h from now')
```

---

## Done When
- [ ] `prisma migrate dev` produces `add_portal_accounts` migration and exits 0
- [ ] `auth.queries.ts` compiles under strict mode
- [ ] All `tests/db/auth.queries.test.ts` pass against Testcontainers Postgres
- [ ] All `tests/service/auth.service.test.ts` pass
- [ ] `registerPortalAccount` never stores plaintext password — verified by test
- [ ] `loginPortalAccount` returns `INVALID_CREDENTIALS` for both missing-email and wrong-password cases — verified by separate tests (timing-safe; both paths return the same error code)
- [ ] `auth.handler.ts` is a thin dispatch — no business logic; shape validation only
- [ ] `POST /auth/register` and `POST /auth/login` work end-to-end via `local/api-server.ts`
- [ ] Spec status updated to ✅ Implemented
- [ ] IMPLEMENTATION_PLAN.md Phase 9 row marked complete
