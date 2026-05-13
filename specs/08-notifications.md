# Spec: Notifications
**FR references**: FR-NOTIF-01, FR-NOTIF-02, FR-NOTIF-03, FR-NOTIF-04, FR-NOTIF-05, FR-NOTIF-06, FR-EMAIL-01, FR-EMAIL-02, FR-EMAIL-03, FR-EMAIL-04, FR-EMAIL-05, FR-EMAIL-06, FR-EMAIL-07, FR-EMAIL-08, FR-EMAIL-09
**Status**: ✅ Implemented

---

## What

Phase 6 implements two distinct concerns unified in `notification.service.ts`: (1) notification preference CRUD — `getNotificationPreferences` and `updateNotificationPreferences`; (2) all nine email-sending service actions — `sendDeclineEmail`, `sendApprovalEmail`, `sendTransactionEmail`, `sendStatementEmail`, `sendPaymentDueReminderEmail`, `sendAutoCloseEmail`, `sendUserCloseEmail`. The notification SQS Lambda handler parses SNS-wrapped messages from all event types published across Phases 2–4.5 and routes each to the appropriate service action. Three email types are preference-gated before sending: transactions (`transactionsEnabled`), statements (`statementsEnabled`), payment-due reminders (`paymentRemindersEnabled`). All other emails are unconditional. Email delivery failures are caught and logged — they never propagate (FR-NOTIF-06). The notifications API handler wires `GET` and `PATCH /accounts/:accountId/notifications`. Two additional query functions — `getStatementByIdOnly` and `getAccountByApplicationId` — are added to Phase 1 query files.

**Implementation order dependency**: `specs/09-billing-lifecycle.md` defines `payment-due-reminder.template.ts` and `auto-close.template.ts`. Phase 6 must not be built until Phase 4.5 (billing lifecycle) is complete.

---

## Why

FR-NOTIF-01–06 require per-account preference storage and enforcement. FR-EMAIL-01–09 require all seven email types to be deliverable. FR-NOTIF-06 requires that email failures never fail the originating business operation — email is best-effort.

---

## New / Modified Files

### Service layer
- `src/service/notification.service.ts` — implements all nine send-email actions and the two preferences actions; replaces Phase 1 stubs

### SQS handler
- `src/handlers/sqs/notification.handler.ts` — parses SNS envelope from SQS record body; routes `eventType` to the correct `serviceClient.invoke` call; handles all seven event types

### API handler
- `src/handlers/api/notifications.handler.ts` — routes `GET /accounts/:accountId/notifications` → `getNotificationPreferences`; routes `PATCH /accounts/:accountId/notifications` → `updateNotificationPreferences`; shape validation only

### Query additions (modifications to Phase 1 files)
- `src/db/queries/statement.queries.ts` — adds `getStatementByIdOnly(prisma: PrismaClient, statementId): Promise<Statement | null>`; used by `sendStatementEmail` where only `statementId` is available in the SNS payload
- `src/db/queries/account.queries.ts` — adds `getAccountByApplicationId(prisma: PrismaClient, applicationId): Promise<Account | null>`; used by `sendApprovalEmail` to fetch the account created during underwriting

### Tests
- `tests/service/notification.service.test.ts` — Vitest + Testcontainers Postgres with fake SES client
- `tests/handlers/notification.handler.test.ts` — integration via MiniStack SQS
- `tests/handlers/notifications.handler.test.ts` — integration via local Express adapter

---

## Behavior

### SNS message envelope

SNS wraps messages before enqueuing to SQS. The `record.body` in the SQS event is the SNS notification JSON:

```json
{
  "Type": "Notification",
  "TopicArn": "...",
  "Message": "{\"eventType\": \"TRANSACTION_POSTED\", \"payload\": {\"transactionId\": \"...\"}}"
}
```

The handler parses `record.body` as the SNS envelope, then parses `envelope.Message` as the inner event payload `{ eventType: string, payload: unknown }`.

### `src/handlers/sqs/notification.handler.ts` — routing table

```
eventType                         payload fields used        service action
───────────────────────────────────────────────────────────────────────────
APPLICATION_DECIDED (DECLINED)    { applicationId }          sendDeclineEmail
APPLICATION_DECIDED (APPROVED)    { applicationId }          sendApprovalEmail
TRANSACTION_POSTED                { transactionId }          sendTransactionEmail
STATEMENT_GENERATED               { statementId }            sendStatementEmail
PAYMENT_DUE_REMINDER              { accountId }              sendPaymentDueReminderEmail
ACCOUNT_AUTO_CLOSED               { accountId }              sendAutoCloseEmail
ACCOUNT_USER_CLOSED               { accountId }              sendUserCloseEmail
```

The split on `payload.decision` for `APPLICATION_DECIDED` is dispatch routing, not domain logic. Unknown `eventType` values are logged as warnings and acknowledged without throwing — unrecognised events must not fill the DLQ.

### `getNotificationPreferences(prisma, _clients, { accountId }): Promise<NotificationPreference>`

- `assertUuid(accountId, 'accountId')`
- `getNotificationPreferences(prisma, accountId)` → null → throw `ACCOUNT_NOT_FOUND`
- Return `NotificationPreference`

### `updateNotificationPreferences(prisma, _clients, input): Promise<NotificationPreference>`

**Input** (`UpdateNotificationPrefsInput`):
```typescript
{ accountId: string; transactionsEnabled?: boolean; statementsEnabled?: boolean; paymentRemindersEnabled?: boolean; }
```

- `assertUuid(accountId, 'accountId')`
- At least one preference field must be present; if none → throw `VALIDATION_ERROR`
- `updateNotificationPreferences(prisma, input)` (partial update)
- Return updated `NotificationPreference`

### Email sending — common pattern

Every `send*Email` function follows this structure:

```
1. assertUuid on all ID arguments
2. Fetch required domain records from DB
3. Guard — if any required record is missing: log warning, return void (defensive)
4. Check preference gate (gated types only) — if disabled: log, return void
5. Build email payload using the appropriate template function
6. clients.sesClient.sendEmail(payload) — catch any error: log, return void (FR-NOTIF-06)
```

### `sendDeclineEmail(prisma, clients, { applicationId }): Promise<void>`

- Fetches: `application`
- **Not preference-gated**
- Template: `buildDeclineEmail(application)` (defined in `specs/03-application-underwriting.md`)

### `sendApprovalEmail(prisma, clients, { applicationId }): Promise<void>`

- Fetches: `application`, `account = getAccountByApplicationId(prisma, applicationId)`
- **Not preference-gated**
- Template: `buildApprovalEmail(application, account)` (defined in `specs/03-application-underwriting.md`)

### `sendTransactionEmail(prisma, clients, { transactionId }): Promise<void>`

- Fetches: `transaction`, `account = getAccountById(prisma, transaction.accountId)`, `prefs`
- **Preference-gated**: skip if `prefs.transactionsEnabled === false` (FR-NOTIF-04)
- Template: `buildTransactionEmail(transaction, account)` (defined in `specs/05-transactions.md`)

### `sendStatementEmail(prisma, clients, { statementId }): Promise<void>`

- Fetches: `statement = getStatementByIdOnly(prisma, statementId)`, `account`, `prefs`
- **Preference-gated**: skip if `prefs.statementsEnabled === false` (FR-NOTIF-05)
- Template: `buildStatementEmail(statement, account)` (defined in `specs/07-statements.md`)

### `sendPaymentDueReminderEmail(prisma, clients, { accountId }): Promise<void>`

- Fetches: `account`, `schedule = getPaymentDueScheduleByAccountId(prisma, accountId)`, `prefs`
- **Preference-gated**: skip if `prefs.paymentRemindersEnabled === false`
- Template: `buildPaymentDueReminderEmail(account, schedule)` (defined in `specs/09-billing-lifecycle.md`)

### `sendAutoCloseEmail(prisma, clients, { accountId }): Promise<void>`

- Fetches: `account`
- **Not preference-gated** — account closure emails are always sent
- Template: `buildAutoCloseEmail(account)` (defined in `specs/09-billing-lifecycle.md`)

### `sendUserCloseEmail(prisma, clients, { accountId }): Promise<void>`

- Fetches: `account`
- **Not preference-gated**
- Template: `buildUserCloseEmail(account)` (defined in `specs/04-account-management.md`)

### `src/handlers/api/notifications.handler.ts`

- `GET /accounts/:accountId/notifications` → `getNotificationPreferences`; returns `200 { data: preferences }`
- `PATCH /accounts/:accountId/notifications` — shape validation: body is an object with at least one boolean preference field; calls `updateNotificationPreferences`; returns `200 { data: preferences }`
- On `PixiCredError`: `{ error: { code, message } }` with `toHttpStatus(code)`

---

## Exact Test Cases

### `tests/service/notification.service.test.ts`
```
test('getNotificationPreferences returns preferences for valid accountId')
test('getNotificationPreferences throws ACCOUNT_NOT_FOUND when no preferences record exists')
test('getNotificationPreferences throws VALIDATION_ERROR for non-UUID accountId')
test('updateNotificationPreferences sets transactionsEnabled to false')
test('updateNotificationPreferences sets statementsEnabled to false')
test('updateNotificationPreferences sets paymentRemindersEnabled to false')
test('updateNotificationPreferences performs partial update — unspecified fields unchanged')
test('updateNotificationPreferences throws VALIDATION_ERROR when no preference fields are provided')
test('updateNotificationPreferences throws VALIDATION_ERROR for non-UUID accountId')
test('sendDeclineEmail calls sesClient.sendEmail with correct recipient and body')
test('sendDeclineEmail returns void without throwing when application does not exist — defensive guard')
test('sendDeclineEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
test('sendApprovalEmail calls sesClient.sendEmail with creditLimit and paymentDueDate in body')
test('sendApprovalEmail returns void without throwing when application does not exist — defensive guard')
test('sendApprovalEmail returns void without throwing when account does not exist — defensive guard')
test('sendApprovalEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
test('sendTransactionEmail calls sesClient.sendEmail when transactionsEnabled is true')
test('sendTransactionEmail returns void without calling sesClient when transactionsEnabled is false')
test('sendTransactionEmail returns void without throwing when transaction does not exist — defensive guard')
test('sendTransactionEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
test('sendStatementEmail calls sesClient.sendEmail when statementsEnabled is true')
test('sendStatementEmail returns void without calling sesClient when statementsEnabled is false')
test('sendStatementEmail returns void without throwing when statement does not exist — defensive guard')
test('sendStatementEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
test('sendPaymentDueReminderEmail calls sesClient.sendEmail when paymentRemindersEnabled is true')
test('sendPaymentDueReminderEmail returns void without calling sesClient when paymentRemindersEnabled is false')
test('sendPaymentDueReminderEmail returns void without throwing when account does not exist — defensive guard')
test('sendPaymentDueReminderEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
test('sendAutoCloseEmail calls sesClient.sendEmail regardless of notification preferences')
test('sendAutoCloseEmail returns void without throwing when account does not exist — defensive guard')
test('sendAutoCloseEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
test('sendUserCloseEmail calls sesClient.sendEmail regardless of notification preferences')
test('sendUserCloseEmail returns void without throwing when account does not exist — defensive guard')
test('sendUserCloseEmail catches sesClient error and does not rethrow — FR-NOTIF-06')
```

### `tests/handlers/notification.handler.test.ts`
```
test('notification handler parses SNS envelope to extract inner Message payload')
test('notification handler routes APPLICATION_DECIDED DECLINED to sendDeclineEmail')
test('notification handler routes APPLICATION_DECIDED APPROVED to sendApprovalEmail')
test('notification handler routes TRANSACTION_POSTED to sendTransactionEmail')
test('notification handler routes STATEMENT_GENERATED to sendStatementEmail')
test('notification handler routes PAYMENT_DUE_REMINDER to sendPaymentDueReminderEmail')
test('notification handler routes ACCOUNT_AUTO_CLOSED to sendAutoCloseEmail')
test('notification handler routes ACCOUNT_USER_CLOSED to sendUserCloseEmail')
test('notification handler acknowledges unknown eventType without throwing')
test('notification handler processes all records in a multi-record SQS batch')
test('full flow: postCharge publishes TRANSACTION_POSTED, notification handler triggers transaction email')
test('full flow: transaction email suppressed when transactionsEnabled is false')
```

### `tests/handlers/notifications.handler.test.ts`
```
test('GET /accounts/:accountId/notifications returns 200 with all three preference fields')
test('GET /accounts/:accountId/notifications returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
test('PATCH /accounts/:accountId/notifications returns 200 with updated preferences on valid body')
test('PATCH /accounts/:accountId/notifications applies partial update — unspecified fields unchanged')
test('PATCH /accounts/:accountId/notifications returns 400 when body contains no preference fields')
test('PATCH /accounts/:accountId/notifications returns 404 ACCOUNT_NOT_FOUND for unknown accountId')
```

---

## Done When
- [x] All nine `send*Email` functions catch SES errors and return void — verified by test
- [x] `sendTransactionEmail` suppressed when `transactionsEnabled = false`
- [x] `sendStatementEmail` suppressed when `statementsEnabled = false`
- [x] `sendPaymentDueReminderEmail` suppressed when `paymentRemindersEnabled = false`
- [x] `sendAutoCloseEmail`, `sendUserCloseEmail`, `sendDeclineEmail`, `sendApprovalEmail` are not preference-gated
- [x] Notification handler correctly parses SNS envelope from SQS record body
- [x] Unknown `eventType` acknowledged without throwing
- [x] `getStatementByIdOnly` and `getAccountByApplicationId` queries added and unit-tested
- [x] Full async flow test: `postCharge` → `TRANSACTION_POSTED` → email sent and suppressed when disabled
- [x] All service unit tests pass with fake SES client
- [x] All handler integration tests pass
- [x] `specs/09-billing-lifecycle.md` complete before this phase is built
- [x] Spec status updated to ✅ Implemented
- [x] `specs/02-service-layer-foundation.md` stubs for all eleven notification/preference actions marked replaced
- [x] `specs/01b-data-model-queries.md` updated to document the two added query functions
- [x] IMPLEMENTATION_PLAN.md Phase 6 row marked complete
