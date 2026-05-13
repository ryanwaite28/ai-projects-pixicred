# Spec: Billing Lifecycle Jobs
**FR references**: FR-BILL-01, FR-BILL-02, FR-BILL-03, FR-BILL-04, FR-BILL-05, FR-BILL-06, FR-BILL-07, FR-BILL-08, FR-EMAIL-07, FR-EMAIL-08
**Status**: ✅ Implemented

---

## What

Phase 4.5 implements `runBillingLifecycle` in `billing-lifecycle.service.ts` and the two email templates it introduces. The function accepts `{ lookaheadDays }` and performs two sweeps in strict order (FR-BILL-05): first the auto-close sweep (accounts 14+ days past due and unsatisfied → close with `AUTO_NONPAYMENT`, publish `ACCOUNT_AUTO_CLOSED`), then the reminder sweep (accounts due within `lookaheadDays` and not yet reminded today → stamp `reminderSentDate`, publish `PAYMENT_DUE_REMINDER`). The `billing-lifecycle` SQS Lambda handler routes both the EventBridge daily cron (FR-BILL-01) and on-demand admin requests through the same service function. The `POST /admin/billing-lifecycle` endpoint enqueues directly to the `billing-lifecycle` SQS queue and returns `202` immediately (FR-BILL-06). Both sweeps are idempotent by design (FR-BILL-07, FR-BILL-08).

**Implementation order**: this phase must be complete before Phase 6 (notifications) since `payment-due-reminder.template.ts` and `auto-close.template.ts` defined here are used by `sendPaymentDueReminderEmail` and `sendAutoCloseEmail` in `notification.service.ts`.

---

## Why

FR-BILL-01–08 define the complete daily billing lifecycle: automated account closure for non-payment and proactive payment-due reminders. These protect the business from unpaid balances and drive FR-DUE-03/04 enforcement. Both sweeps are idempotent so the job can safely run multiple times per day without side effects.

---

## New / Modified Files

### Service layer
- `src/service/billing-lifecycle.service.ts` — implements `runBillingLifecycle`; replaces Phase 1 stub

### SQS handler
- `src/handlers/sqs/billing-lifecycle.handler.ts` — parses SQS body as `{ lookaheadDays: number }`, calls `runBillingLifecycle`; acknowledges on success, throws on error to trigger retry

### Admin API handler
- `src/handlers/api/admin.handler.ts` — routes `POST /admin/billing-lifecycle`; validates and enqueues to `BILLING_LIFECYCLE_QUEUE_URL`; returns `202 Accepted` immediately

### Email templates
- `src/emails/payment-due-reminder.template.ts` — `buildPaymentDueReminderEmail(account, schedule): SendEmailInput` per FR-EMAIL-07; renders `src/emails/templates/payment-due-reminder.hbs` via Handlebars
- `src/emails/templates/payment-due-reminder.hbs` — HTML email template for payment-due reminder notifications
- `src/emails/auto-close.template.ts` — `buildAutoCloseEmail(account): SendEmailInput` per FR-EMAIL-08; renders `src/emails/templates/auto-close.hbs` via Handlebars
- `src/emails/templates/auto-close.hbs` — HTML email template for auto-close confirmation notifications

### Tests
- `tests/service/billing-lifecycle.service.test.ts` — Vitest + Testcontainers Postgres
- `tests/handlers/billing-lifecycle.handler.test.ts` — integration via MiniStack SQS
- `tests/handlers/admin.handler.test.ts` — integration via local Express adapter
- `tests/emails/payment-due-reminder.template.test.ts`
- `tests/emails/auto-close.template.test.ts`

---

## Behavior

### `runBillingLifecycle(prisma, clients, { lookaheadDays }): Promise<{ closedCount: number; remindedCount: number }>`

**Input**: `{ lookaheadDays: number }` — integer ≥ 1 (FR-BILL-02)

**Validation**: `lookaheadDays < 1` or non-integer → throw `VALIDATION_ERROR`

**Sweep 1 — auto-close** (runs first, FR-BILL-04, FR-BILL-05):

```typescript
const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
const overdueAccounts = await getAccountsOverdueForAutoClose(prisma, todayIso);
// Returns ACTIVE/SUSPENDED accounts where satisfied = false
// AND payment_due_date < todayIso − 14 days
```

For each account in `overdueAccounts`:
- Call `closeAccount(prisma, clients, { accountId, reason: 'AUTO_NONPAYMENT' })` from `account.service.ts` — this publishes `ACCOUNT_AUTO_CLOSED` to SNS (FR-BILL-04)
- Idempotency is structural: `getAccountsOverdueForAutoClose` filters by `status IN ('ACTIVE', 'SUSPENDED')` so already-closed accounts are excluded on re-runs (FR-BILL-08)

**Sweep 2 — reminders** (runs second, FR-BILL-03, FR-BILL-05):

```typescript
const dueAccounts = await getAccountsDueForReminder(prisma, todayIso, lookaheadDays);
// Returns ACTIVE/SUSPENDED accounts where satisfied = false
// AND payment_due_date <= todayIso + lookaheadDays days
// AND (reminder_sent_date IS NULL OR reminder_sent_date < todayIso)
```

Accounts auto-closed in Sweep 1 have status `CLOSED` and are excluded by this query's status filter. This is why Sweep 1 must run first (FR-BILL-05).

For each account in `dueAccounts`:
1. `updateReminderSentDate(prisma, accountId, todayIso)` — stamps the date **before** publishing to SNS. If the SNS publish fails after a successful DB stamp, the account is skipped on retry that day (missed reminder preferred over duplicate reminder). (FR-BILL-07)
2. Publish `PAYMENT_DUE_REMINDER` to `SNS_TOPIC_ARN` with `{ accountId }`

**Return**: `{ closedCount: overdueAccounts.length, remindedCount: dueAccounts.length }`

### `src/emails/payment-due-reminder.template.ts`

```typescript
export function buildPaymentDueReminderEmail(
  account: Account,
  schedule: PaymentDueSchedule
): SendEmailInput
```

Fields (FR-EMAIL-07):
- `to = account.holderEmail`, `from = SES_FROM_EMAIL env var`
- Subject references upcoming payment due date
- Body includes: `account.currentBalance`, `schedule.paymentDueDate`, days until due (computed from today and `schedule.paymentDueDate`), minimum payment amount (`computeMinimumPayment(account.currentBalance)` imported from `payment.service.ts`), warning that the account will be auto-closed if unpaid 14 days after the due date. Body HTML produced by rendering `src/emails/templates/payment-due-reminder.hbs` via Handlebars.

### `src/emails/auto-close.template.ts`

```typescript
export function buildAutoCloseEmail(account: Account): SendEmailInput
```

Fields (FR-EMAIL-08):
- `to = account.holderEmail`, `from = SES_FROM_EMAIL env var`
- Subject confirms account was automatically closed
- Body includes: confirmation of closure due to non-payment, `account.currentBalance` at time of closure, instructions to reapply for a new account. Body HTML produced by rendering `src/emails/templates/auto-close.hbs` via Handlebars.

### `src/handlers/sqs/billing-lifecycle.handler.ts`

Shape validates `lookaheadDays` is a positive integer. Throws on error to trigger SQS retry.

```typescript
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { lookaheadDays } = JSON.parse(record.body) as { lookaheadDays: number };
    await serviceClient.invoke({ action: 'runBillingLifecycle', payload: { lookaheadDays } });
  }
};
```

### `src/handlers/api/admin.handler.ts`

`POST /admin/billing-lifecycle`:
- Shape validation: `lookaheadDays` is optional; if present must be a positive integer; defaults to `7`
- **Enqueues directly to SQS — does not invoke the service Lambda** (FR-BILL-06): the job runs asynchronously when the SQS consumer fires. The service layer boundary rule governs domain logic; enqueuing a job is infrastructure dispatch.
- `clients.sqsClient.sendMessage(BILLING_LIFECYCLE_QUEUE_URL, { lookaheadDays })`
- Returns `202 { data: { queued: true, lookaheadDays } }`

---

## Exact Test Cases

### `tests/service/billing-lifecycle.service.test.ts`
```
test('runBillingLifecycle closes ACTIVE accounts where satisfied is false and due_date is more than 14 days ago')
test('runBillingLifecycle closes SUSPENDED accounts where satisfied is false and due_date is more than 14 days ago')
test('runBillingLifecycle does not close accounts where due_date is exactly 14 days ago')
test('runBillingLifecycle does not close accounts where satisfied is true')
test('runBillingLifecycle does not close already-CLOSED accounts — auto-close idempotency FR-BILL-08')
test('runBillingLifecycle sets closeReason to AUTO_NONPAYMENT on auto-closed accounts')
test('runBillingLifecycle publishes ACCOUNT_AUTO_CLOSED event via closeAccount for each auto-closed account')
test('runBillingLifecycle sends reminder for ACTIVE account due within lookaheadDays and not reminded today')
test('runBillingLifecycle sends reminder for SUSPENDED account due within lookaheadDays and not reminded today')
test('runBillingLifecycle does not send reminder for account already reminded today — FR-BILL-07 idempotency')
test('runBillingLifecycle does not send reminder for account where satisfied is true')
test('runBillingLifecycle does not send reminder for account with due_date beyond lookaheadDays')
test('runBillingLifecycle does not send reminder for CLOSED account')
test('runBillingLifecycle stamps reminderSentDate on schedule row before publishing PAYMENT_DUE_REMINDER event')
test('runBillingLifecycle publishes PAYMENT_DUE_REMINDER event for each reminded account')
test('runBillingLifecycle runs auto-close sweep first — account closed in sweep 1 is not reminded in sweep 2')
test('runBillingLifecycle returns closedCount equal to number of auto-closed accounts')
test('runBillingLifecycle returns remindedCount equal to number of reminded accounts')
test('runBillingLifecycle throws VALIDATION_ERROR when lookaheadDays is less than 1')
test('runBillingLifecycle is idempotent — running twice on the same day produces no duplicate closes or reminders')
test('runBillingLifecycle with lookaheadDays 1 only reminds accounts due within the next 1 day')
test('runBillingLifecycle with lookaheadDays 7 reminds accounts due within the next 7 days')
```

### `tests/emails/payment-due-reminder.template.test.ts`
```
test('buildPaymentDueReminderEmail sets to field to account holderEmail')
test('buildPaymentDueReminderEmail subject references payment due date')
test('buildPaymentDueReminderEmail body includes current balance')
test('buildPaymentDueReminderEmail body includes payment due date from schedule')
test('buildPaymentDueReminderEmail body includes minimum payment amount computed from balance')
test('buildPaymentDueReminderEmail body includes warning about auto-close 14 days after due date')
test('buildPaymentDueReminderEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/emails/auto-close.template.test.ts`
```
test('buildAutoCloseEmail sets to field to account holderEmail')
test('buildAutoCloseEmail subject confirms account was automatically closed')
test('buildAutoCloseEmail body confirms closure was due to non-payment')
test('buildAutoCloseEmail body includes current balance at time of closure')
test('buildAutoCloseEmail body includes instructions to reapply')
test('buildAutoCloseEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/handlers/billing-lifecycle.handler.test.ts`
```
test('billing-lifecycle handler invokes runBillingLifecycle with lookaheadDays from SQS message body')
test('billing-lifecycle handler processes all records in a multi-record SQS batch')
test('full scheduled flow: EventBridge enqueues daily message with lookaheadDays 7, handler runs, overdue account is closed')
test('full on-demand flow: POST /admin/billing-lifecycle enqueues message, handler runs, due-soon account receives reminder')
test('billing-lifecycle handler idempotency — running twice on the same day does not double-close or double-remind')
```

### `tests/handlers/admin.handler.test.ts`
```
test('POST /admin/billing-lifecycle returns 202 with queued true and default lookaheadDays of 7')
test('POST /admin/billing-lifecycle returns 202 with provided lookaheadDays when valid integer')
test('POST /admin/billing-lifecycle returns 400 when lookaheadDays is zero')
test('POST /admin/billing-lifecycle returns 400 when lookaheadDays is negative')
test('POST /admin/billing-lifecycle returns 400 when lookaheadDays is not an integer')
test('POST /admin/billing-lifecycle enqueues message to BILLING_LIFECYCLE_QUEUE_URL with correct body')
test('POST /admin/billing-lifecycle returns 202 immediately — does not wait for job to complete')
```

---

## Done When
- [x] Auto-close sweep runs before reminder sweep in the same function execution — verified by ordering test
- [x] Accounts closed in auto-close sweep are excluded from reminder sweep in the same run
- [x] `reminderSentDate` stamped before SNS publish — not after
- [x] Auto-close idempotency: already-`CLOSED` accounts excluded by query status filter (FR-BILL-08)
- [x] Reminder idempotency: `reminder_sent_date = today` excludes re-reminding on same day (FR-BILL-07)
- [x] `runBillingLifecycle` calls `closeAccount` from `account.service.ts` directly — no duplicate close logic
- [x] `computeMinimumPayment` imported from `payment.service.ts` in reminder template — not re-implemented
- [x] Payment-due reminder email includes all fields from FR-EMAIL-07 including auto-close warning
- [x] Auto-close email includes all fields from FR-EMAIL-08 including outstanding balance
- [x] Admin handler returns `202` immediately without waiting for the job to complete
- [x] Admin handler enqueues to SQS — does not invoke service Lambda directly
- [x] All service unit tests pass against Testcontainers Postgres
- [x] All handler and email template tests pass
- [x] Both scheduled and on-demand flow integration tests pass against MiniStack
- [x] Spec status updated to ✅ Implemented
- [x] `specs/02-service-layer-foundation.md` stub for `runBillingLifecycle` marked replaced
- [x] `specs/08-notifications.md` dependency on this spec's templates confirmed satisfied
- [x] IMPLEMENTATION_PLAN.md Phase 4.5 row marked complete
