# PixiCred — Implementation Plan

> Coordination layer between PROJECT.md (what/why) and `specs/` (how). Read this at the start of every session. Update it at the end of every completed phase. If this file and a spec disagree, the spec is authoritative for behavior; this file is authoritative for sequencing and phase status.

---

## How to Use This File

1. Check the **Progress Tracker** — find the first phase that is not ✅ Complete
2. Verify all its **prerequisites** in the dependency graph are ✅ Complete
3. Read the **governing spec** listed in the Per-Phase Breakdown
4. Follow the standard **Session Protocol** at the bottom of this file

---

## Phase Dependency Graph

```
Phase 0 — Scaffold
  └─► Phase 1a — Data Model: Schema & Types
        └─► Phase 1b — Data Model: Query Layer
              └─► Phase 1c — Service Layer Foundation
                    └─► Phase 2 — Application & Underwriting
                          └─► Phase 3a — Account Management
                                └─► Phase 3b — Transactions
                                      └─► Phase 4 — Payments
                                            ├─► Phase 4.5 — Billing Lifecycle ──────────┐
                                            │                                            ▼
                                            └─► Phase 5 — Statements ──────► Phase 6 — Notifications
                                                                                    └─► Phase 7 — API Gateway & Full Wiring
                                                                                          └─► Phase 8 — DevOps & Hardening
                                                                                                └─► Phase 9 — Backend Auth
                                                                                                      └─► Phase 10a — Frontend: Scaffold & Auth Shell
                                                                                                            └─► Phase 10b — Frontend: Public Apply Flow
                                                                                                                  └─► Phase 10c — Frontend: Account Pages
                                                                                                                        └─► Phase 10d — Frontend: Settings Pages
```

**Phase 6 depends on both Phase 4.5 AND Phase 5** — all email templates must exist before the notification service is built.

**Phase 10b, 10c, 10d all depend on Phase 10a** — auth shell (routing, guard, interceptor, auth service) must exist before any pages are added.

**Never start a phase whose prerequisites are not ✅ Complete.**

---

## Cross-Cutting Patterns

These patterns are established in Phase 1b and must be used by every subsequent phase. Defined here once; specs reference them rather than redefining them.

### Error shape

```typescript
// Thrown by service layer:
throw new PixiCredError('ERROR_CODE', 'Human-readable message');

// API response envelope (error):
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }

// HTTP status mapping: see src/lib/errors.ts toHttpStatus()
```

### Structured log format (one JSON line per service invocation)

```json
{ "level": "info",  "action": "submitApplication", "durationMs": 47 }
{ "level": "warn",  "action": "postCharge", "durationMs": 12, "code": "INSUFFICIENT_CREDIT", "error": "Amount exceeds available credit" }
{ "level": "error", "action": "runCreditCheck", "durationMs": 5, "error": "Unexpected error from DB" }
```

### Service function signature convention

```typescript
export async function actionName(
  prisma: PrismaClient,
  clients: ServiceClients,
  input: ActionNameInput
): Promise<ActionNameResult>
```

`prisma` and `clients` are always the first two arguments. Tests inject a Testcontainers-backed `PrismaClient` for `prisma` and fakes for `clients`.

### Idempotency pattern (all write endpoints with `idempotencyKey`)

```
1. assertUuid(idempotencyKey, 'idempotencyKey')
2. existing = getRecordByIdempotencyKey(prisma, scopeId, idempotencyKey)
3. if (existing) return existing   ← skip ALL remaining steps including SNS publish
4. execute domain operation (within prisma.$transaction() if multiple writes)
5. publish SNS event
6. return new record
```

### Response envelope

```typescript
// Success:  { "data": { ... } }
// Error:    { "error": { "code": "...", "message": "..." } }
```

### UUID validation

All ID parameters on every service function and handler are validated with `assertUuid(value, fieldName)` from `src/lib/validate.ts`. Non-UUID IDs → `VALIDATION_ERROR` before any DB access.

---

## Per-Phase Breakdown

---

### Phase 0 — Project Scaffold

**Governing spec**: `specs/00-scaffold.md`
**Prerequisites**: none
**Session estimate**: 1–2 sessions

**Key files**:
- `package.json`, `tsconfig.json`, `.eslintrc.json`, `.prettierrc`, `.gitignore`
- `docker-compose.yml`, `Dockerfile`, `infra/ministack/init.sh`
- `src/db/client.ts`, `prisma/schema.prisma` (placeholder), `prisma/migrations/.gitkeep`
- `src/emails/templates/.gitkeep`
- `scripts/build.sh` (placeholder bundle), `esbuild.config.ts`
- `infra/terraform/bootstrap/`, `infra/terraform/envs/dev/`, `infra/terraform/envs/prod/`
- `.env.example`, `.github/workflows/ci.yml` (lint + typecheck only), `.github/workflows/migrate.yml`

**Done when**:
- [ ] `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` all exit 0
- [ ] `docker-compose up -d` starts Postgres + MiniStack cleanly
- [ ] `infra/ministack/init.sh` creates all 4 queues + 4 DLQs + SNS topic
- [ ] `npm run db:migrate` applies migration idempotently
- [ ] All scaffold tests pass
- [ ] `terraform validate` passes for bootstrap module

---

### Phase 1a — Data Model: Schema & Types

**Governing spec**: `specs/01a-data-model-schema.md`
**Prerequisites**: Phase 0 ✅
**Session estimate**: 1 session

**Key files**:
- `prisma/schema.prisma` — 6 core models, all indexes, `binaryTargets` for Lambda
- `src/types/index.ts` — all domain interfaces and enums

**Done when**:
- [ ] `prisma migrate dev` produces initial migration and exits 0
- [ ] `prisma generate` produces typed PrismaClient
- [ ] All TypeScript interfaces compile under strict mode

---

### Phase 1b — Data Model: Query Layer

**Governing spec**: `specs/01b-data-model-queries.md`
**Prerequisites**: Phase 1a ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `src/db/queries/application.queries.ts`
- `src/db/queries/account.queries.ts`
- `src/db/queries/payment-due-schedule.queries.ts`
- `src/db/queries/transaction.queries.ts`
- `src/db/queries/statement.queries.ts`
- `src/db/queries/notification.queries.ts`
- `tests/db/*.test.ts` (6 test files)

**Done when**:
- [x] All query files compile under strict mode
- [x] All `tests/db/*.test.ts` pass against Testcontainers Postgres
- [x] Boundary conditions for `getAccountsDueForReminder` and `getAccountsOverdueForAutoClose` verified by test
- [x] All query function tests pass against Testcontainers Postgres
- [x] `getActiveApplicationOrAccountByEmail` handles all 4 blocking cases correctly
- [x] `getAccountsDueForReminder` and `getAccountsOverdueForAutoClose` boundary tests pass

---

### Phase 1c — Service Layer Foundation

**Governing spec**: `specs/02-service-layer-foundation.md`
**Prerequisites**: Phase 1b ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `src/lib/errors.ts` — `PixiCredError`, `ErrorCode`, `toHttpStatus`
- `src/lib/logger.ts` — structured JSON logger
- `src/lib/validate.ts` — `assertUuid`
- `src/types/index.ts` — extended with `ServiceAction` union and all payload types
- `src/service/application.service.ts` through `src/service/billing-lifecycle.service.ts` — all stubs
- `src/handlers/service/service.handler.ts` — dispatch router
- `src/clients/service.client.ts` — dual-mode (Lambda / HTTP)
- `src/clients/ses.client.ts`, `sns.client.ts`, `sqs.client.ts`
- `local/service-server.ts`

**Done when**:
- [x] All 22 stubs throw `NOT_IMPLEMENTED` — confirmed by routing tests
- [x] `ServiceAction` union covers all 22 actions from PROJECT.md Section 6.2
- [x] `service.client.ts` dual-mode confirmed by unit tests
- [x] `local/service-server.ts` starts on port 3001 and returns correct envelope
- [x] All cross-cutting pattern tests pass (`errors`, `validate`, routing)

---

### Phase 2 — Application & Underwriting

**Governing spec**: `specs/03-application-underwriting.md`
**Prerequisites**: Phase 1c ✅
**Session estimate**: 2–3 sessions

**Key files**:
- `src/service/application.service.ts` — `submitApplication`, `getApplication`, `runCreditCheck`
- `src/handlers/sqs/credit-check.handler.ts`
- `src/handlers/api/applications.handler.ts`
- `src/emails/decline.template.ts`
- `src/emails/approval.template.ts`

**Critical invariants**:
- `runCreditCheck` is atomic: `Account` + `PaymentDueSchedule` + `NotificationPreference` created in one `prisma.$transaction()`
- `runCreditCheck` publishes SNS events — never calls email functions directly
- Credit limit: `Math.round(Math.min(Math.max(income * 0.10, 500), 15000))`
- Payment due date: 25th of the next calendar month; December rolls to January of next year

**Done when**:
- [x] All 5 mock SSN test vectors pass (see CLAUDE.md)
- [x] Duplicate email check (FR-APP-09) handles all 4 blocking states
- [x] Atomic account creation rollback test passes
- [ ] Full async flow test (submit → SQS → credit check → decision) passes against MiniStack

---

### Phase 3a — Account Management

**Governing spec**: `specs/04-account-management.md`
**Prerequisites**: Phase 2 ✅
**Session estimate**: 1 session

**Key files**:
- `src/service/account.service.ts` — `getAccount`, `closeAccount` (both reason values)
- `src/handlers/api/accounts.handler.ts`
- `src/emails/user-close.template.ts`

**Critical invariants**:
- `getAccount` derives `availableCredit` in-process — never reads it from DB
- `closeAccount` publishes `ACCOUNT_USER_CLOSED` or `ACCOUNT_AUTO_CLOSED` — never calls email directly
- `CLOSED → CLOSED` throws `ACCOUNT_ALREADY_CLOSED`

**Done when**:
- [x] All 3 status-transition cases tested (`ACTIVE→CLOSED`, `SUSPENDED→CLOSED`, `CLOSED→CLOSED` error)
- [x] Reapplication test: `getActiveApplicationOrAccountByEmail` returns null after close

---

### Phase 3b — Transactions

**Governing spec**: `specs/05-transactions.md`
**Prerequisites**: Phase 3a ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `src/service/transaction.service.ts` — `postCharge`, `getTransactions`
- `src/handlers/api/transactions.handler.ts`
- `src/emails/transaction.template.ts`

**Critical invariants**:
- Idempotency check runs **before** all domain validations
- Idempotent replay produces zero DB writes and zero SNS publishes
- `postCharge` is atomic (insert + balance update in one `prisma.$transaction()`)

**Done when**:
- [x] Idempotency-check-before-validation test passes (account now CLOSED, key replayed → returns original transaction)
- [x] Cursor pagination boundary tests pass

---

### Phase 4 — Payments

**Governing spec**: `specs/06-payments.md`
**Prerequisites**: Phase 3b ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `src/service/payment.service.ts` — `postPayment`, `computeMinimumPayment`
- `src/handlers/api/payments.handler.ts`

**Critical invariants**:
- Idempotency check runs **before** all domain validations
- `"FULL"` resolves to `currentBalance` at time of processing; replay returns originally-resolved amount
- Balance reaching 0 → `markPaymentDueScheduleSatisfied` called within same `prisma.$transaction()`
- `satisfied` flag is one-way — never reset by subsequent charges
- Payments allowed on `SUSPENDED` accounts; rejected on `CLOSED`
- `computeMinimumPayment` is exported — consumed by Phase 5 (statements) and Phase 4.5 (billing lifecycle)

**Done when**:
- [x] `"FULL"` idempotency replay test passes (balance changed since original payment)
- [x] `satisfied` one-way flag test passes (charge after zero-balance payment does not reset flag)
- [x] Atomic rollback test: no balance update if transaction insert fails

---

### Phase 4.5 — Billing Lifecycle Jobs

**Governing spec**: `specs/09-billing-lifecycle.md`
**Prerequisites**: Phase 4 ✅
**Session estimate**: 2 sessions

> **Must complete before Phase 6.** Defines `payment-due-reminder.template.ts` and `auto-close.template.ts` used by `notification.service.ts`.

**Key files**:
- `src/service/billing-lifecycle.service.ts` — `runBillingLifecycle`
- `src/handlers/sqs/billing-lifecycle.handler.ts`
- `src/handlers/api/admin.handler.ts`
- `src/emails/payment-due-reminder.template.ts`
- `src/emails/auto-close.template.ts`

**Critical invariants**:
- Auto-close sweep runs **before** reminder sweep in the same execution (FR-BILL-05)
- `reminderSentDate` stamped before SNS publish (missed reminder preferred over duplicate)
- Admin handler enqueues to SQS — does not invoke service Lambda directly
- `runBillingLifecycle` calls `closeAccount` from `account.service.ts` — no logic duplication

**Done when**:
- [x] Sweep-ordering test: account closed in sweep 1 is not reminded in sweep 2
- [x] Reminder idempotency: same-day re-run sends 0 additional reminders
- [x] Auto-close idempotency: already-CLOSED accounts excluded by status filter

---

### Phase 5 — Statements

**Governing spec**: `specs/07-statements.md`
**Prerequisites**: Phase 4 ✅
**Session estimate**: 2 sessions

> **Must complete before Phase 6.** Defines `statement.template.ts` used by `notification.service.ts`.

**Key files**:
- `src/service/statement.service.ts` — `generateStatement`, `generateAllStatements`, `getStatements`, `getStatement`
- `src/handlers/sqs/statement-gen.handler.ts`
- `src/handlers/api/statements.handler.ts`
- `src/emails/statement.template.ts`
- `src/db/queries/account.queries.ts` — adds `getAccountsForStatements`
- `src/db/queries/transaction.queries.ts` — adds `getTransactionsByAccountAndPeriod`

**Critical invariants**:
- `openingBalance = closingBalance + totalPayments − totalCharges`
- `dueDate = periodEnd + 21 days`
- `getTransactionsByAccountAndPeriod` upper bound is exclusive (`<` not `<=`)
- Idempotency: same period → return existing statement, no second SNS event

**Done when**:
- [x] On-demand period uses prior statement's `periodEnd` or `account.createdAt`
- [x] `generateAllStatements` includes ACTIVE + SUSPENDED, skips CLOSED
- [x] Period boundary test: transaction at `periodEnd` excluded, at `periodStart` included
- [x] Full scheduled flow test passes against MiniStack

---

### Phase 6 — Notifications

**Governing spec**: `specs/08-notifications.md`
**Prerequisites**: Phase 4.5 ✅ AND Phase 5 ✅
**Session estimate**: 2 sessions

**Key files**:
- `src/service/notification.service.ts` — 9 send-email actions + 2 preference actions
- `src/handlers/sqs/notification.handler.ts`
- `src/handlers/api/notifications.handler.ts`
- `src/db/queries/statement.queries.ts` — adds `getStatementByIdOnly`
- `src/db/queries/account.queries.ts` — adds `getAccountByApplicationId`

**Critical invariants**:
- Every `send*Email` catches SES errors and returns void — never re-throws (FR-NOTIF-06)
- Handler parses SNS envelope: `record.body` → `envelope.Message` → inner `{ eventType, payload }`
- Unknown `eventType` acknowledged without throwing — no DLQ pollution
- 3 preference-gated types: `sendTransactionEmail`, `sendStatementEmail`, `sendPaymentDueReminderEmail`
- 4 unconditional types: `sendDeclineEmail`, `sendApprovalEmail`, `sendAutoCloseEmail`, `sendUserCloseEmail`

**Done when**:
- [x] All 9 `send*Email` SES-error swallow tests pass with fake SES client
- [x] Preference gate tests pass for all 3 gated types
- [x] Full async flow test: `postCharge` → `TRANSACTION_POSTED` → email sent and suppressed when disabled

---

### Phase 7 — API Gateway & Full Wiring

**Governing spec**: `specs/10a-api-wiring.md`
**Prerequisites**: Phase 6 ✅
**Session estimate**: 2–3 sessions

**Key files**:
- `local/api-server.ts` — 13 routes, service dispatch direct calls
- `local/worker.ts` — 4-queue poller with SNS envelope unwrapping
- `scripts/build.sh` — 12 Lambda bundles + 3 local bundles
- `scripts/seed-local.ts`
- `infra/terraform/modules/lambda/`, `sqs/`, `rds/`, `api-gateway/`
- `infra/terraform/envs/dev/main.tf`, `infra/terraform/envs/prod/main.tf`

**Critical invariants**:
- No IAM role shared across Lambda functions (PROJECT.md Section 5.7)
- 3 EventBridge rules with exact cron expressions from PROJECT.md
- All 4 SQS consumer Lambdas have event source mappings
- `local/api-server.ts` admin route enqueues to MiniStack SQS — not Lambda invoke

**Done when**:
- [x] `npm run build` bundles all 15 entry points without error
- [x] All Terraform modules and envs pass `terraform validate`
- [x] End-to-end HTTP integration tests pass against full local stack
- [x] Worker correctly unwraps SNS envelope for notification queue messages

---

### Phase 8 — DevOps & Hardening

**Governing spec**: `specs/10b-devops-hardening.md`
**Prerequisites**: Phase 7 ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `.github/workflows/ci.yml` — full pipeline (includes `prisma generate` in lint-typecheck job)
- `.github/workflows/migrate.yml` — `prisma migrate deploy` + S3 audit trail sync
- `src/db/client.ts` — Secrets Manager integration, exports PrismaClient singleton
- CloudWatch alarms in Terraform env modules
- `README.md`

**Critical invariants**:
- Manual approval gate (`prod-approval` environment) before `deploy-prod` job — not `production`
- DB client fetches Secrets Manager + generates RDS IAM token once at cold start — not per request; local mode uses `DATABASE_URL` from env
- Service Lambda role has `rds-db:connect` scoped to `pixicred_app` — never `rds-data:*`
- `migrate.yml` uses `MIGRATIONS_DATABASE_URL` from Secrets Manager (password-based, `migrations-db-user`) — never IAM auth for migrations
- DLQ-depth alarms on all 4 DLQs; Lambda-error alarms on service + all 4 consumer Lambdas

**Done when**:
- [x] CI pipeline runs end-to-end on push to main (includes `prisma generate` in lint-typecheck job)
- [x] `.github/workflows/migrate.yml` triggers on schema changes; uses `MIGRATIONS_DATABASE_URL`; syncs migrations to S3
- [x] `src/db/client.ts` generates RDS IAM token in non-local mode; test covers both branches
- [x] RDS Terraform module has `iam_database_authentication_enabled = true`
- [ ] Post-Terraform DB users created: `pixicred_app` (IAM) + `migrations-db-user` (password)
- [x] All CloudWatch alarms provisioned in Terraform
- [x] `README.md` complete with local setup, test commands, and deployment instructions

---

### Phase 9 — Backend Auth

**Governing spec**: `specs/11-auth.md`
**Prerequisites**: Phase 8 ✅ (`JWT_SECRET` in Secrets Manager)
**Session estimate**: 1 session

**Key files**:
- `prisma/schema.prisma` — adds `PortalAccount` model; new migration `add_portal_accounts`
- `src/db/queries/auth.queries.ts`
- `src/service/auth.service.ts` — `registerPortalAccount`, `loginPortalAccount`
- `src/handlers/api/auth.handler.ts` — `POST /auth/register`, `POST /auth/login`

**Critical invariants**:
- Plaintext password never stored or logged
- `INVALID_CREDENTIALS` returned for both missing-email and wrong-password (same error, no user enumeration)
- `auth.handler.ts` does shape validation only — all business rules in `auth.service.ts`

**Done when**:
- [x] `add_portal_accounts` migration applies to fresh Postgres
- [x] All `tests/service/auth.service.test.ts` pass
- [x] All `tests/db/auth.queries.test.ts` pass
- [x] `POST /auth/register` and `POST /auth/login` work end-to-end via local API server

---

### Phase 10a — Frontend: Scaffold & Auth Shell

**Governing spec**: `specs/12a-frontend-scaffold.md`
**Prerequisites**: Phase 9 ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `frontend/` — Angular 17+ workspace
- `frontend/src/app/app.routes.ts` — full route table
- `frontend/src/app/services/auth.service.ts`
- `frontend/src/app/interceptors/auth.interceptor.ts`
- `frontend/src/app/guards/auth.guard.ts`
- `frontend/src/app/pages/login/`, `pages/setup/`

**Critical invariants**:
- All components standalone — no NgModule
- JWT in `localStorage` under key `pixicred_jwt` only
- Auth guard checks `exp` client-side on every navigation

**Done when**:
- [ ] `ng serve` starts on port 4200; all routes resolve
- [ ] Auth guard and interceptor work end-to-end; 401/403 clears JWT and redirects to `/login`
- [ ] Login and setup pages submit correctly to local API

---

### Phase 10b — Frontend: Public Apply Flow

**Governing spec**: `specs/12b-frontend-public.md`
**Prerequisites**: Phase 10a ✅
**Session estimate**: 1 session

**Key files**:
- `frontend/src/app/pages/welcome/`
- `frontend/src/app/pages/apply/`
- `frontend/src/app/pages/apply-confirmation/`
- `frontend/src/app/pages/apply-status/`
- `frontend/src/app/services/application.service.ts`

**Done when**:
- [ ] Full apply → confirmation → status flow works end-to-end against local API
- [ ] All three status states render correctly (PENDING / APPROVED / DECLINED)
- [ ] APPROVED status shows link to `/setup`

---

### Phase 10c — Frontend: Account Pages

**Governing spec**: `specs/12c-frontend-account.md`
**Prerequisites**: Phase 10a ✅
**Session estimate**: 1–2 sessions

**Key files**:
- `frontend/src/app/services/account.service.ts`
- `frontend/src/app/pages/dashboard/`
- `frontend/src/app/pages/transactions/`
- `frontend/src/app/pages/payments/`
- `frontend/src/app/pages/statements/`

**Done when**:
- [ ] Dashboard loads account summary; shows last 5 transactions
- [ ] Transactions cursor pagination works; "Load More" hides when exhausted
- [ ] Payments FULL toggle sends correct payload; confirmation shows resolved amount
- [ ] Statements detail expands inline; on-demand generate prepends new statement

---

### Phase 10d — Frontend: Settings Pages

**Governing spec**: `specs/12d-frontend-settings.md`
**Prerequisites**: Phase 10a ✅, Phase 10c ✅ (AccountService)
**Session estimate**: 1 session

**Key files**:
- `frontend/src/app/services/settings.service.ts`
- `frontend/src/app/pages/settings-notifications/`
- `frontend/src/app/pages/settings-account/`

**Done when**:
- [ ] Notification toggles fire PATCH immediately on change; revert on error
- [ ] Close account modal confirms before calling DELETE; logs out and navigates to `/` on success

---

## Session Protocol

Paste this prompt at the start of any new implementation session:

```
You are implementing PixiCred. Before writing any code:

1. Read CLAUDE.md in full and acknowledge the project rules
2. Read IMPLEMENTATION_PLAN.md — identify the first incomplete phase
   and confirm all prerequisites are ✅ Complete in the Progress Tracker
3. Read the governing spec for that phase in specs/
4. Report: which phase you are about to implement, which files are in scope,
   and any blockers you observe

Do not write any implementation code until you have completed steps 1–3
and reported your findings.
```

---

## Progress Tracker

| Phase | Name | Governing Spec | Status | Date Completed |
|---|---|---|---|---|
| 0 | Project Scaffold | `specs/00-scaffold.md` | ✅ Complete | 2026-05-09 |
| 1a | Data Model: Schema & Types | `specs/01a-data-model-schema.md` | ✅ Complete | 2026-05-12 |
| 1b | Data Model: Query Layer | `specs/01b-data-model-queries.md` | ✅ Complete | 2026-05-12 |
| 1c | Service Layer Foundation | `specs/02-service-layer-foundation.md` | ✅ Complete | 2026-05-13 |
| 2 | Application & Underwriting | `specs/03-application-underwriting.md` | ✅ Complete | 2026-05-13 |
| 3a | Account Management | `specs/04-account-management.md` | ✅ Complete | 2026-05-13 |
| 3b | Transactions | `specs/05-transactions.md` | ✅ Complete | 2026-05-13 |
| 4 | Payments | `specs/06-payments.md` | ✅ Complete | 2026-05-13 |
| 4.5 | Billing Lifecycle Jobs | `specs/09-billing-lifecycle.md` | ✅ Complete | 2026-05-13 |
| 5 | Statements | `specs/07-statements.md` | ✅ Complete | 2026-05-13 |
| 6 | Notifications | `specs/08-notifications.md` | ✅ Complete | 2026-05-13 |
| 7 | API Gateway & Full Wiring | `specs/10a-api-wiring.md` | ✅ Complete | 2026-05-13 |
| 8 | DevOps & Hardening | `specs/10b-devops-hardening.md` | ✅ Complete | 2026-05-13 |
| 9 | Backend Auth | `specs/11-auth.md` | ✅ Complete | 2026-05-13 |
| 10a | Frontend: Scaffold & Auth Shell | `specs/12a-frontend-scaffold.md` | ⬜ Not Started | — |
| 10b | Frontend: Public Apply Flow | `specs/12b-frontend-public.md` | ⬜ Not Started | — |
| 10c | Frontend: Account Pages | `specs/12c-frontend-account.md` | ⬜ Not Started | — |
| 10d | Frontend: Settings Pages | `specs/12d-frontend-settings.md` | ⬜ Not Started | — |

---

*Update this table — tick done-when items, change status, stamp the date — at the end of every session in which a phase is completed. A stale plan misleads every future session.*
