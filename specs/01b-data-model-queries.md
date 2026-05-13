# Spec: Data Model — Query Layer
**FR references**: FR-APP-01, FR-APP-02, FR-APP-09, FR-ACC-02, FR-ACC-06, FR-DUE-01, FR-DUE-04, FR-TXN-01, FR-STMT-03, FR-NOTIF-01, FR-BILL-03, FR-BILL-04
**Status**: ✅ Implemented
**Prerequisite**: Phase 1a (schema migrated, types defined)

---

## What

Phase 1b implements the typed query layer in `src/db/queries/` — one file per domain. Each file wraps every database operation the service layer will need using `PrismaClient` with no business logic, only parameterized Prisma calls and result mapping. All six query files and their Vitest + Testcontainers test suites are implemented here.

---

## Why

The service layer (Phase 1c) depends on a stable, typed query interface. Separating query implementation from schema definition keeps each phase's scope narrow and ensures the query contract is verified independently before any service logic is built.

---

## New / Modified Files

- `src/db/queries/application.queries.ts`
- `src/db/queries/account.queries.ts`
- `src/db/queries/payment-due-schedule.queries.ts`
- `src/db/queries/transaction.queries.ts`
- `src/db/queries/statement.queries.ts`
- `src/db/queries/notification.queries.ts`
- `tests/db/application.queries.test.ts`
- `tests/db/account.queries.test.ts`
- `tests/db/payment-due-schedule.queries.test.ts`
- `tests/db/transaction.queries.test.ts`
- `tests/db/statement.queries.test.ts`
- `tests/db/notification.queries.test.ts`

---

## Behavior

### `src/db/queries/application.queries.ts`

```typescript
export interface CreateApplicationInput {
  email: string; firstName: string; lastName: string;
  dateOfBirth: string; annualIncome: number; mockSsn: string;
}

export async function createApplication(prisma: PrismaClient, input: CreateApplicationInput): Promise<Application>

export async function getApplicationById(prisma: PrismaClient, applicationId: string): Promise<Application | null>

export async function getActiveApplicationOrAccountByEmail(
  prisma: PrismaClient, email: string
): Promise<{ type: 'application' | 'account'; status: string } | null>
// Returns non-null when email has: PENDING app, APPROVED app, ACTIVE account, or SUSPENDED account.
// Returns null for DECLINED app or CLOSED account. Used to enforce FR-APP-09.

export async function updateApplicationStatus(
  prisma: PrismaClient, applicationId: string, status: ApplicationStatus, creditLimit?: number
): Promise<Application>
// Sets status and decidedAt = NOW(). Sets creditLimit when provided (APPROVED path only).
```

### `src/db/queries/account.queries.ts`

```typescript
export interface CreateAccountInput {
  applicationId: string; holderEmail: string; creditLimit: number; paymentDueDate: string;
}

export async function createAccount(prisma: PrismaClient, input: CreateAccountInput): Promise<Account>
// Inserts with currentBalance = 500.00 (FR-ACC-06), status = 'ACTIVE'.

export async function getAccountById(prisma: PrismaClient, accountId: string): Promise<Account | null>

export async function updateAccountStatus(
  prisma: PrismaClient, accountId: string, status: AccountStatus, closeReason?: CloseReason
): Promise<Account>
// Sets status, closeReason, and closedAt = NOW() when status = 'CLOSED'.

export async function updateAccountBalance(prisma: PrismaClient, accountId: string, newBalance: number): Promise<Account>

export async function getActiveAccountByEmail(prisma: PrismaClient, email: string): Promise<Account | null>
// Returns ACTIVE or SUSPENDED account for the email.

export async function getAccountsForStatements(prisma: PrismaClient): Promise<Account[]>
// Returns all ACTIVE and SUSPENDED accounts. Used by generateAllStatements (Phase 5).

export async function getAccountByApplicationId(prisma: PrismaClient, applicationId: string): Promise<Account | null>
// Added in Phase 6. Fetches account by applicationId; used by sendApprovalEmail where only applicationId is in the SNS payload.
```

### `src/db/queries/payment-due-schedule.queries.ts`

```typescript
export async function createPaymentDueSchedule(
  prisma: PrismaClient, accountId: string, paymentDueDate: string
): Promise<PaymentDueSchedule>

export async function getPaymentDueScheduleByAccountId(
  prisma: PrismaClient, accountId: string
): Promise<PaymentDueSchedule | null>

export async function markPaymentDueScheduleSatisfied(prisma: PrismaClient, accountId: string): Promise<PaymentDueSchedule>
// Sets satisfied = true, satisfiedAt = NOW(). No-op if already satisfied (FR-DUE-04).

export async function updateReminderSentDate(
  prisma: PrismaClient, accountId: string, date: string
): Promise<PaymentDueSchedule>

export async function getAccountsDueForReminder(
  prisma: PrismaClient, todayIso: string, lookaheadDays: number
): Promise<Array<{ accountId: string; holderEmail: string; paymentDueDate: string; currentBalance: number }>>
// ACTIVE/SUSPENDED accounts where satisfied = false
// AND paymentDueDate <= todayIso + lookaheadDays
// AND (reminderSentDate IS NULL OR reminderSentDate < todayIso)

export async function getAccountsOverdueForAutoClose(
  prisma: PrismaClient, todayIso: string
): Promise<Array<{ accountId: string; holderEmail: string }>>
// ACTIVE/SUSPENDED accounts where satisfied = false AND paymentDueDate < todayIso - 14 days
```

### `src/db/queries/transaction.queries.ts`

```typescript
export interface CreateTransactionInput {
  accountId: string; type: TransactionType; merchantName?: string;
  amount: number; idempotencyKey: string;
}

export async function createTransaction(prisma: PrismaClient, input: CreateTransactionInput): Promise<Transaction>

export async function getTransactionByIdempotencyKey(
  prisma: PrismaClient, accountId: string, idempotencyKey: string
): Promise<Transaction | null>

export interface GetTransactionsInput { accountId: string; cursor?: string; limit?: number; }

export async function getTransactionsByAccountId(prisma: PrismaClient, input: GetTransactionsInput): Promise<Transaction[]>
// Sorted createdAt DESC. Cursor-paginated by transactionId. Default limit 20.

export async function getTransactionById(prisma: PrismaClient, transactionId: string): Promise<Transaction | null>

export async function getTransactionsByAccountAndPeriod(
  prisma: PrismaClient, accountId: string, periodStart: Date, periodEnd: Date
): Promise<Transaction[]>
// Sorted createdAt ASC. Upper bound is exclusive (lt), lower bound inclusive (gte).
// Used by generateStatementForAccount (Phase 5).
```

### `src/db/queries/statement.queries.ts`

```typescript
export interface CreateStatementInput {
  accountId: string; periodStart: Date; periodEnd: Date;
  openingBalance: number; closingBalance: number; totalCharges: number;
  totalPayments: number; minimumPaymentDue: number; dueDate: string;
}

export async function createStatement(prisma: PrismaClient, input: CreateStatementInput): Promise<Statement>

export async function getStatementByPeriod(
  prisma: PrismaClient, accountId: string, periodStart: Date, periodEnd: Date
): Promise<Statement | null>
// Used for idempotency check (FR-STMT-08).

export async function getStatementById(prisma: PrismaClient, accountId: string, statementId: string): Promise<Statement | null>

export async function getStatementsByAccountId(prisma: PrismaClient, accountId: string): Promise<Statement[]>
// Sorted periodEnd DESC. Does NOT populate transactions[].

export async function getStatementWithTransactions(
  prisma: PrismaClient, accountId: string, statementId: string
): Promise<Statement | null>
// Populates transactions[] from createdAt >= periodStart AND createdAt < periodEnd.

export async function getStatementByIdOnly(prisma: PrismaClient, statementId: string): Promise<Statement | null>
// Added in Phase 6. Fetches statement by statementId alone (no accountId); used by sendStatementEmail where only statementId is in the SNS payload.
```

### `src/db/queries/notification.queries.ts`

```typescript
export interface UpdateNotificationPrefsInput {
  accountId: string;
  transactionsEnabled?: boolean;
  statementsEnabled?: boolean;
  paymentRemindersEnabled?: boolean;
}

export async function createNotificationPreferences(prisma: PrismaClient, accountId: string): Promise<NotificationPreference>
// Inserts with all three flags = true (FR-NOTIF-01).

export async function getNotificationPreferences(prisma: PrismaClient, accountId: string): Promise<NotificationPreference | null>

export async function updateNotificationPreferences(
  prisma: PrismaClient, input: UpdateNotificationPrefsInput
): Promise<NotificationPreference>
// Partial update — only sets fields explicitly provided. Sets updatedAt = NOW().
```

---

## Exact Test Cases

### `tests/db/application.queries.test.ts`
```
test('createApplication inserts a row and returns mapped Application with status PENDING')
test('createApplication sets creditLimit to null on insert')
test('getApplicationById returns null when id does not exist')
test('getApplicationById returns Application for existing id')
test('getActiveApplicationOrAccountByEmail returns null when no active record exists')
test('getActiveApplicationOrAccountByEmail returns application type when PENDING application exists')
test('getActiveApplicationOrAccountByEmail returns application type when APPROVED application exists')
test('getActiveApplicationOrAccountByEmail returns account type when ACTIVE account exists')
test('getActiveApplicationOrAccountByEmail returns account type when SUSPENDED account exists')
test('getActiveApplicationOrAccountByEmail returns null when email has only DECLINED application')
test('getActiveApplicationOrAccountByEmail returns null when email has only CLOSED account')
test('updateApplicationStatus sets status APPROVED with creditLimit and stamps decidedAt')
test('updateApplicationStatus sets status DECLINED and leaves creditLimit null')
```

### `tests/db/account.queries.test.ts`
```
test('createAccount inserts row with currentBalance 500.00 and status ACTIVE')
test('createAccount derives availableCredit as creditLimit minus 500')
test('createAccount sets paymentDueDate to provided date')
test('getAccountById returns null when id does not exist')
test('getAccountById returns Account with all fields mapped')
test('updateAccountStatus sets status to SUSPENDED')
test('updateAccountStatus sets status to CLOSED with closeReason and closedAt')
test('updateAccountBalance sets currentBalance and recalculates availableCredit')
test('getActiveAccountByEmail returns ACTIVE account for email')
test('getActiveAccountByEmail returns SUSPENDED account for email')
test('getActiveAccountByEmail returns null when only CLOSED account exists for email')
```

### `tests/db/payment-due-schedule.queries.test.ts`
```
test('createPaymentDueSchedule inserts row with satisfied false')
test('getPaymentDueScheduleByAccountId returns null when not found')
test('getPaymentDueScheduleByAccountId returns schedule for existing accountId')
test('markPaymentDueScheduleSatisfied sets satisfied true and stamps satisfiedAt')
test('markPaymentDueScheduleSatisfied is a no-op when already satisfied')
test('updateReminderSentDate sets reminder_sent_date to provided ISO date')
test('getAccountsDueForReminder returns accounts where due_date within lookahead and not reminded today')
test('getAccountsDueForReminder excludes accounts already reminded today')
test('getAccountsDueForReminder excludes satisfied accounts')
test('getAccountsDueForReminder excludes CLOSED accounts')
test('getAccountsOverdueForAutoClose returns accounts more than 14 days past due and unsatisfied')
test('getAccountsOverdueForAutoClose excludes accounts exactly 14 days past due')
test('getAccountsOverdueForAutoClose excludes satisfied accounts')
test('getAccountsOverdueForAutoClose excludes CLOSED accounts')
```

### `tests/db/transaction.queries.test.ts`
```
test('createTransaction inserts CHARGE with merchantName and returns mapped Transaction')
test('createTransaction inserts PAYMENT with null merchantName')
test('getTransactionByIdempotencyKey returns null when key does not exist for account')
test('getTransactionByIdempotencyKey returns existing transaction for matching accountId + key')
test('getTransactionsByAccountId returns transactions sorted by createdAt descending')
test('getTransactionsByAccountId returns empty array when account has no transactions')
test('getTransactionsByAccountId respects cursor — returns only rows older than cursor row')
test('getTransactionsByAccountId respects limit parameter')
test('getTransactionById returns null when not found')
test('getTransactionById returns transaction for existing id')
```

### `tests/db/statement.queries.test.ts`
```
test('createStatement inserts row and returns Statement with empty transactions array')
test('getStatementByPeriod returns null when no match')
test('getStatementByPeriod returns statement when period exactly matches')
test('getStatementById returns null when not found')
test('getStatementById returns statement for matching accountId and statementId')
test('getStatementsByAccountId returns statements sorted by periodEnd descending')
test('getStatementsByAccountId returns empty array when account has no statements')
test('getStatementWithTransactions returns statement with transactions in period')
test('getStatementWithTransactions returns statement with empty transactions when none in period')
```

### `tests/db/notification.queries.test.ts`
```
test('createNotificationPreferences inserts row with all three flags true')
test('getNotificationPreferences returns null when accountId not found')
test('getNotificationPreferences returns preferences for existing accountId')
test('updateNotificationPreferences sets transactionsEnabled to false')
test('updateNotificationPreferences sets statementsEnabled to false')
test('updateNotificationPreferences sets paymentRemindersEnabled to false')
test('updateNotificationPreferences updates updatedAt timestamp')
test('updateNotificationPreferences performs partial update — unspecified fields unchanged')
```

---

## Done When
- [x] All six query files compile with no implicit `any` under strict mode
- [x] All tests in `tests/db/*.test.ts` pass against a Testcontainers Postgres instance
- [x] `getActiveApplicationOrAccountByEmail` correctly returns non-null for PENDING app, APPROVED app, ACTIVE account, SUSPENDED account — and null for DECLINED app and CLOSED account
- [x] `getAccountsDueForReminder` and `getAccountsOverdueForAutoClose` boundary conditions verified by test
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 1b row marked complete
