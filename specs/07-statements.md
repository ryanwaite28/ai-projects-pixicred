# Spec: Statements
**FR references**: FR-STMT-01, FR-STMT-02, FR-STMT-03, FR-STMT-04, FR-STMT-05, FR-STMT-06, FR-STMT-07, FR-STMT-08, FR-EMAIL-04, NFR-02
**Status**: ✅ Implemented

---

## What

Phase 5 implements the full statement domain: `generateStatement` (on-demand), `generateAllStatements` (scheduled, called by the SQS consumer), `getStatements`, and `getStatement`. A statement captures `periodStart`, `periodEnd`, `openingBalance`, `closingBalance`, `totalCharges`, `totalPayments`, `minimumPaymentDue` (from `computeMinimumPayment`), and `dueDate` (21 days after `periodEnd`). Statement generation is idempotent per account per period via the `(account_id, period_start, period_end)` unique index. After generation a `STATEMENT_GENERATED` event is published to SNS. The statement-gen SQS Lambda handler routes EventBridge-triggered messages to `generateAllStatements`. The statement email template is implemented here. Two additional query functions are introduced — `getAccountsForStatements` and `getTransactionsByAccountAndPeriod` — as modifications to files established in Phase 1.

---

## Why

FR-STMT-01–08 define the complete statement lifecycle. FR-STMT-08 (idempotency) prevents duplicate statements when EventBridge fires twice or an on-demand call races a scheduled run. FR-STMT-07 drives the downstream notification flow (FR-EMAIL-04 via Phase 6).

---

## New / Modified Files

### Service layer
- `src/service/statement.service.ts` — implements `generateStatement`, `generateAllStatements`, `getStatements`, `getStatement`; replaces Phase 1 stubs

### SQS handler
- `src/handlers/sqs/statement-gen.handler.ts` — parses SQS body as `{ period: 'weekly' | 'monthly' }`, calls `generateAllStatements`; acknowledges on success, throws on error to trigger retry

### API handler
- `src/handlers/api/statements.handler.ts` — routes `POST /accounts/:accountId/statements` → `generateStatement`; routes `GET /accounts/:accountId/statements` → `getStatements`; routes `GET /accounts/:accountId/statements/:statementId` → `getStatement`; shape validation only

### Email template
- `src/emails/statement.template.ts` — `buildStatementEmail(statement: Statement, account: Account): SendEmailInput` per FR-EMAIL-04; renders `src/emails/templates/statement.hbs` via Handlebars
- `src/emails/templates/statement.hbs` — HTML email template for statement notifications

### Query additions (modifications to Phase 1 files)
- `src/db/queries/account.queries.ts` — adds `getAccountsForStatements(prisma: PrismaClient): Promise<Account[]>` returning all `ACTIVE` and `SUSPENDED` accounts
- `src/db/queries/transaction.queries.ts` — adds `getTransactionsByAccountAndPeriod(prisma: PrismaClient, accountId, periodStart, periodEnd): Promise<Transaction[]>`

### Tests
- `tests/service/statement.service.test.ts` — Vitest + Testcontainers Postgres
- `tests/handlers/statement-gen.handler.test.ts` — integration via MiniStack SQS
- `tests/handlers/statements.handler.test.ts` — integration via local Express adapter
- `tests/emails/statement.template.test.ts`

---

## Behavior

### Period computation

**Weekly** (`period = 'weekly'`, triggered Monday 00:00 UTC, FR-STMT-01):
```
periodEnd   = start of this Monday in UTC (floored to 00:00:00 UTC)
periodStart = periodEnd − 7 days
```

**Monthly** (`period = 'monthly'`, triggered 1st of month 00:00 UTC, FR-STMT-01):
```
periodEnd   = first day of this month, 00:00:00 UTC
periodStart = first day of the previous month, 00:00:00 UTC
```

**On-demand** (`generateStatement`):
```
periodEnd   = NOW() (UTC)
periodStart = previous statement's periodEnd   (if a prior statement exists for this account)
            | account.createdAt               (if no prior statement exists)
```

Period computations run inside the service layer, not in handlers.

### Statement field computation (per account)

Given `periodStart`, `periodEnd`, and the live `account`:

1. **Idempotency check** (FR-STMT-08): `getStatementByPeriod(prisma, accountId, periodStart, periodEnd)` → if found, return existing statement immediately. No re-generation, no second SNS publish.
2. Fetch: `getTransactionsByAccountAndPeriod(prisma, accountId, periodStart, periodEnd)`
3. Compute fields:
   - `totalCharges    = sum of amount for all CHARGE rows in result (0 if none)`
   - `totalPayments   = sum of amount for all PAYMENT rows in result (0 if none)`
   - `closingBalance  = account.currentBalance` at time of generation
   - `openingBalance  = closingBalance + totalPayments − totalCharges`
   - `minimumPaymentDue = computeMinimumPayment(closingBalance)` (imported from `payment.service.ts`)
   - `dueDate         = periodEnd + 21 days` as ISO date YYYY-MM-DD (FR-STMT-03)
4. `createStatement(prisma, { accountId, periodStart, periodEnd, openingBalance, closingBalance, totalCharges, totalPayments, minimumPaymentDue, dueDate })`
5. Publish `STATEMENT_GENERATED` to `SNS_TOPIC_ARN` with `{ statementId, accountId }` (FR-STMT-07)
6. Return `Statement` (without `transactions[]` — populated only by `getStatement`)

### `generateStatement(prisma, clients, { accountId }): Promise<Statement>`

- `assertUuid(accountId, 'accountId')`
- `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
- Compute on-demand period (see above)
- Execute statement generation logic (steps 1–6 above)
- Return `Statement`

### `generateAllStatements(prisma, clients, { period }): Promise<Statement[]>`

- Compute `periodStart` / `periodEnd` from `period` type
- `getAccountsForStatements(prisma)` — all `ACTIVE` and `SUSPENDED` accounts
- For each account: run statement generation logic (idempotent per account)
- Return array of all generated-or-pre-existing statements

### `getStatements(prisma, _clients, { accountId }): Promise<Statement[]>`

- `assertUuid(accountId, 'accountId')`
- `getAccountById(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
- `getStatementsByAccountId(prisma, accountId)` sorted `periodEnd DESC` (FR-STMT-05)
- Return `Statement[]` without `transactions[]`

### `getStatement(prisma, _clients, { accountId, statementId }): Promise<Statement>`

- `assertUuid(accountId, 'accountId')`
- `assertUuid(statementId, 'statementId')`
- `getStatementWithTransactions(prisma, accountId, statementId)` → null → throw `STATEMENT_NOT_FOUND`
- Return `Statement` with `transactions[]` populated (FR-STMT-06)

### `src/emails/statement.template.ts`

```typescript
export function buildStatementEmail(statement: Statement, account: Account): SendEmailInput
```

Fields (FR-EMAIL-04): `to = account.holderEmail`, `from = SES_FROM_EMAIL env var`, subject references the statement period, body includes `periodStart`–`periodEnd` range, `closingBalance`, `minimumPaymentDue`, `dueDate`. Body HTML produced by rendering `src/emails/templates/statement.hbs` via Handlebars.

### `src/handlers/sqs/statement-gen.handler.ts`

Shape validates `period` is `'weekly'` or `'monthly'`. Calls `generateAllStatements`. Throws on error to trigger SQS retry (FR-STMT-02).

```typescript
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body) as { period: 'weekly' | 'monthly' };
    await serviceClient.invoke({ action: 'generateAllStatements', payload: { period: body.period } });
  }
};
```

### `src/handlers/api/statements.handler.ts`

- `POST /accounts/:accountId/statements` → `generateStatement`; returns `201 { data: statement }`
- `GET /accounts/:accountId/statements` → `getStatements`; returns `200 { data: statements[] }`
- `GET /accounts/:accountId/statements/:statementId` → `getStatement`; returns `200 { data: statement }`
- On `PixiCredError`: `{ error: { code, message } }` with `toHttpStatus(code)`

### New query: `getAccountsForStatements(prisma: PrismaClient): Promise<Account[]>`

```typescript
prisma.account.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } } })
```

Used exclusively by `generateAllStatements`.

### New query: `getTransactionsByAccountAndPeriod(prisma: PrismaClient, accountId, periodStart, periodEnd): Promise<Transaction[]>`

```typescript
prisma.transaction.findMany({
  where: { accountId, createdAt: { gte: periodStart, lt: periodEnd } },
  orderBy: { createdAt: 'asc' },
})
```

Upper bound is exclusive (`lt`) so a transaction at exactly `periodEnd` is not double-counted across contiguous periods.

---

## Exact Test Cases

### `tests/service/statement.service.test.ts`
```
test('generateStatement sets periodStart to account.createdAt when no prior statements exist')
test('generateStatement sets periodStart to previous statement periodEnd when prior statement exists')
test('generateStatement sets periodEnd to approximately NOW at time of call')
test('generateStatement computes totalCharges as sum of CHARGE transactions in period')
test('generateStatement computes totalPayments as sum of PAYMENT transactions in period')
test('generateStatement computes closingBalance as account currentBalance at generation time')
test('generateStatement computes openingBalance as closingBalance plus totalPayments minus totalCharges')
test('generateStatement computes minimumPaymentDue using computeMinimumPayment formula')
test('generateStatement sets dueDate to 21 days after periodEnd as ISO date string')
test('generateStatement publishes STATEMENT_GENERATED event to SNS client with statementId and accountId')
test('generateStatement returns Statement without transactions array')
test('generateStatement throws ACCOUNT_NOT_FOUND for unknown accountId')
test('generateStatement throws VALIDATION_ERROR for non-UUID accountId')
test('generateStatement is idempotent — second call with same computed period returns existing statement')
test('generateStatement idempotency — no additional SNS event published on replay')
test('generateAllStatements generates one statement per ACTIVE account')
test('generateAllStatements generates one statement per SUSPENDED account')
test('generateAllStatements skips CLOSED accounts')
test('generateAllStatements weekly period — periodStart is exactly 7 days before periodEnd')
test('generateAllStatements monthly period — periodStart is first day of previous month')
test('generateAllStatements is idempotent — running twice for the same period creates no duplicate rows')
test('generateAllStatements returns array containing all statements including pre-existing ones')
test('getStatements returns statements sorted by periodEnd descending')
test('getStatements returns empty array when account has no statements')
test('getStatements throws ACCOUNT_NOT_FOUND for unknown accountId')
test('getStatements throws VALIDATION_ERROR for non-UUID accountId')
test('getStatement returns Statement with transactions array populated for the period')
test('getStatement transactions array contains only transactions within the statement period')
test('getStatement throws STATEMENT_NOT_FOUND for unknown statementId')
test('getStatement throws STATEMENT_NOT_FOUND when statementId belongs to a different accountId')
test('getStatement throws VALIDATION_ERROR for non-UUID statementId')
test('getStatement throws VALIDATION_ERROR for non-UUID accountId')
test('getTransactionsByAccountAndPeriod upper bound is exclusive — transaction at exactly periodEnd is excluded')
test('getTransactionsByAccountAndPeriod lower bound is inclusive — transaction at exactly periodStart is included')
```

### `tests/emails/statement.template.test.ts`
```
test('buildStatementEmail sets to field to account holderEmail')
test('buildStatementEmail subject references statement period')
test('buildStatementEmail body includes closing balance')
test('buildStatementEmail body includes minimum payment due')
test('buildStatementEmail body includes due date')
test('buildStatementEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/handlers/statements.handler.test.ts`
```
test('POST /accounts/:accountId/statements returns 201 with generated statement')
test('POST /accounts/:accountId/statements returns 201 with existing statement on idempotent replay')
test('POST /accounts/:accountId/statements returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('GET /accounts/:accountId/statements returns 200 with statements array sorted by periodEnd descending')
test('GET /accounts/:accountId/statements returns 200 with empty array when no statements exist')
test('GET /accounts/:accountId/statements returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('GET /accounts/:accountId/statements/:statementId returns 200 with statement and populated transactions array')
test('GET /accounts/:accountId/statements/:statementId returns 404 STATEMENT_NOT_FOUND for unknown statementId')
```

### `tests/handlers/statement-gen.handler.test.ts`
```
test('statement-gen handler calls generateAllStatements with period weekly for weekly SQS message')
test('statement-gen handler calls generateAllStatements with period monthly for monthly SQS message')
test('statement-gen handler processes all records in a multi-record SQS batch')
test('full scheduled flow: EventBridge enqueues weekly SQS message, handler runs, statements created for all active accounts')
```

---

## Done When
- [x] `generateStatement` on-demand period uses prior statement's `periodEnd` or `account.createdAt` (FR-STMT-04)
- [x] Weekly: `periodEnd` = start of current Monday UTC, `periodStart` = 7 days prior; monthly: `periodEnd` = first of this month, `periodStart` = first of prior month — verifying FR-STMT-01
- [x] Statement-gen SQS handler shape-validates `period`; throws on error to trigger SQS retry (FR-STMT-02)
- [x] `openingBalance = closingBalance + totalPayments − totalCharges`; all statement fields match FR-STMT-03
- [x] `dueDate` is exactly 21 days after `periodEnd` (FR-STMT-03)
- [x] `STATEMENT_GENERATED` event published to SNS after each new statement is created (FR-STMT-07)
- [x] Idempotency: re-running with same period returns existing statement, no new DB row, no second SNS event (FR-STMT-08, NFR-02)
- [x] `generateAllStatements` includes `ACTIVE` and `SUSPENDED` accounts; skips `CLOSED` (FR-STMT-01)
- [x] `getStatements` returns list sorted `periodEnd DESC` (FR-STMT-05)
- [x] `getStatement` populates `transactions[]`; `getStatements` does not (FR-STMT-06)
- [x] `getTransactionsByAccountAndPeriod` upper bound is exclusive
- [x] Statement email includes all fields required by FR-EMAIL-04
- [x] All service unit tests pass against Testcontainers Postgres
- [x] All handler integration tests pass; full scheduled flow test passes against MiniStack
- [x] Spec status updated to ✅ Implemented
- [x] `specs/01b-data-model-queries.md` updated to document the two added query functions
- [x] `specs/02-service-layer-foundation.md` stubs for all four statement actions marked replaced
- [x] IMPLEMENTATION_PLAN.md Phase 5 row marked complete
