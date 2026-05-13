# Spec: Application & Underwriting
**FR references**: FR-APP-01, FR-APP-02, FR-APP-03, FR-APP-04, FR-APP-05, FR-APP-06, FR-APP-07, FR-APP-08, FR-APP-09, FR-ACC-01, FR-ACC-06, FR-ACC-07, FR-ACC-08, FR-DUE-01, FR-DUE-02, FR-DUE-05, FR-NOTIF-01, FR-EMAIL-01, FR-EMAIL-02, FR-AUTH-07, NFR-01
**Status**: ✅ Implemented

---

## What

Phase 2 implements the full application submission and credit-check underwriting flow. `submitApplication` validates input, enforces the one-active-record-per-email rule, creates an `Application` in `PENDING` status, and publishes `APPLICATION_SUBMITTED` to SNS. `runCreditCheck` applies the mock SSN rule, then either declines (updating status, publishing SNS event) or approves (updating status, computing credit limit, atomically creating `Account` + `PaymentDueSchedule` + `NotificationPreference`, publishing SNS event). `getApplication` returns application status by ID. The `credit-check` SQS Lambda handler invokes `runCreditCheck`. Email templates for decline and approval are implemented. The API Lambda handler for `/applications` dispatches `submitApplication` and `getApplication` to the service layer with no business logic of its own.

---

## Why

FR-APP-01–09 define the complete application lifecycle. NFR-01 requires the credit check to run asynchronously via SQS so that `POST /applications` returns immediately with `PENDING` status. This phase is the first that introduces real business logic and async event flow.

---

## New / Modified Files

### Service layer
- `src/service/application.service.ts` — implements `submitApplication`, `getApplication`, `runCreditCheck`; replaces Phase 1 stubs
- `src/service/account.service.ts` — `createAccountForApprovedApplication` private helper called only by `runCreditCheck` (not a ServiceAction); the `getAccount` and `closeAccount` stubs remain until Phase 3

### SQS handler
- `src/handlers/sqs/credit-check.handler.ts` — parses SQS event body as `{ applicationId: string }`, calls `serviceClient.invoke({ action: 'runCreditCheck', payload: { applicationId } })`; acknowledges on success, throws on error to trigger SQS retry

### API handler
- `src/handlers/api/applications.handler.ts` — routes `POST /applications` → `submitApplication`; routes `GET /applications/:applicationId` → `getApplication`; performs input shape validation only; maps results to HTTP response envelope

### Email templates
- `src/emails/decline.template.ts` — `buildDeclineEmail(application: Application): SendEmailInput` per FR-EMAIL-01; renders `src/emails/templates/decline.hbs` via Handlebars
- `src/emails/templates/decline.hbs` — HTML email template for decline notification
- `src/emails/approval.template.ts` — `buildApprovalEmail(application: Application, account: Account): SendEmailInput` per FR-EMAIL-02; renders `src/emails/templates/approval.hbs` via Handlebars
- `src/emails/templates/approval.hbs` — HTML email template for approval notification

### Tests
- `tests/service/application.service.test.ts` — Vitest + Testcontainers Postgres
- `tests/handlers/applications.handler.test.ts` — integration via local Express adapter
- `tests/handlers/credit-check.handler.test.ts` — integration via MiniStack SQS
- `tests/emails/decline.template.test.ts`
- `tests/emails/approval.template.test.ts`

---

## Behavior

### `submitApplication(prisma, clients, input): Promise<Application>`

**Input** (`SubmitApplicationInput`):
```typescript
{
  email: string; firstName: string; lastName: string;
  dateOfBirth: string; annualIncome: number; mockSsn: string;
}
```

**Validation** (FR-APP-02 — shape-level, throw `VALIDATION_ERROR`):
- All six fields present and non-empty
- `email` matches RFC-5322 basic format (contains `@` and domain with `.`)
- `mockSsn` matches `/^\d{5}$/` exactly
- `annualIncome` is a positive finite number (`> 0`)
- `dateOfBirth` is a valid ISO date string (`YYYY-MM-DD`, parseable as a real calendar date)

**Duplicate check** (FR-APP-09):
- Call `getActiveApplicationOrAccountByEmail(prisma, email)`
- Non-null result → throw `PixiCredError('DUPLICATE_APPLICATION', ...)`

**On success** (FR-APP-03):
- `createApplication(prisma, { email, firstName, lastName, dateOfBirth, annualIncome, mockSsn })`
- Publish `APPLICATION_SUBMITTED` to `SNS_TOPIC_ARN` with `{ applicationId }`
- Return the created `Application`

Side effects: one `applications` row inserted; one SNS message published. SNS fan-out handles SQS enqueuing.

### `getApplication(prisma, _clients, { applicationId }): Promise<Application>`

- `assertUuid(applicationId, 'applicationId')`
- `getApplicationById(prisma, applicationId)` → null → throw `APPLICATION_NOT_FOUND`
- Return `Application`

### `runCreditCheck(prisma, clients, { applicationId }): Promise<void>`

- `assertUuid(applicationId, 'applicationId')`
- `getApplicationById(prisma, applicationId)` → null → throw `APPLICATION_NOT_FOUND`
- Apply mock SSN decision (FR-APP-04):

```typescript
const isDeclined = (ssn: string): boolean => ssn[0] === '5' && ssn[4] === '5';
```

**DECLINED path** (FR-APP-05):
- `updateApplicationStatus(prisma, applicationId, 'DECLINED')`
- Publish `APPLICATION_DECIDED` to SNS with `{ applicationId, decision: 'DECLINED' }`
- The notification consumer (Phase 6) calls `sendDeclineEmail` when it receives this event. `runCreditCheck` does NOT call email functions directly.

**APPROVED path** (FR-APP-06, FR-APP-07):
- Compute credit limit: `Math.round(Math.min(Math.max(application.annualIncome * 0.10, 500), 15000))`
- `updateApplicationStatus(prisma, applicationId, 'APPROVED', creditLimit)`
- Compute payment due date (FR-ACC-07, FR-DUE-02):
  - `dueMonth = createdAt.getUTCMonth() === 11 ? 0 : createdAt.getUTCMonth() + 1`
  - `dueYear  = createdAt.getUTCMonth() === 11 ? createdAt.getUTCFullYear() + 1 : createdAt.getUTCFullYear()`
  - `paymentDueDate = new Date(Date.UTC(dueYear, dueMonth, 25)).toISOString().slice(0, 10)`
- Within a single `prisma.$transaction()` (atomic):
  - `createAccount(prisma, { applicationId, holderEmail: application.email, creditLimit, paymentDueDate })` — `currentBalance` defaults to 500.00 (FR-ACC-06)
  - `createPaymentDueSchedule(prisma, account.accountId, paymentDueDate)` (FR-DUE-01, FR-DUE-02)
  - `createNotificationPreferences(prisma, account.accountId)` (FR-NOTIF-01)
- Publish `APPLICATION_DECIDED` to SNS with `{ applicationId, decision: 'APPROVED', accountId }`
- Return `void`

### `src/emails/decline.template.ts`

```typescript
export function buildDeclineEmail(application: Application): SendEmailInput
```

Fields (FR-EMAIL-01): `to = application.email`, `from = SES_FROM_EMAIL env var`, subject references the application, body includes a note that the applicant may reapply after any existing account is closed. Body HTML is produced by rendering `src/emails/templates/decline.hbs` with Handlebars: `Handlebars.compile(templateSource)({ applicantName, ... })`.

### `src/emails/approval.template.ts`

```typescript
export function buildApprovalEmail(application: Application, account: Account): SendEmailInput
```

Fields (FR-EMAIL-02, FR-AUTH-07): `to = application.email`, `from = SES_FROM_EMAIL env var`. Body HTML produced by rendering `src/emails/templates/approval.hbs` via Handlebars. The template must include:
- Approved credit limit (`account.creditLimit`)
- Opening balance of $500
- First payment due date (`account.paymentDueDate`)
- `account.accountId` displayed as **"Account Setup Code"** — this is how the applicant links their account to portal login
- A prompt to visit `https://pixicred.com/setup` and enter the Account Setup Code to create their portal password

This explicit "Account Setup Code" label is required by FR-AUTH-07; without it the applicant has no path to the `/setup` page.

### `src/handlers/sqs/credit-check.handler.ts`

Shape validation only: `applicationId` must be a non-empty string. All other validation in service layer.

```typescript
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { applicationId } = JSON.parse(record.body) as { applicationId: string };
    await serviceClient.invoke({ action: 'runCreditCheck', payload: { applicationId } });
  }
};
```

### `src/handlers/api/applications.handler.ts`

- `POST /applications` — shape-validates all six fields present, `mockSsn` is a string, `annualIncome` is a number; calls `submitApplication`; returns `201 { data: application }`
- `GET /applications/:applicationId` — `applicationId` non-empty string; calls `getApplication`; returns `200 { data: application }`
- On `PixiCredError`: returns `{ error: { code, message } }` with `toHttpStatus(code)`

---

## Exact Test Cases

### `tests/service/application.service.test.ts`
```
test('submitApplication creates Application with status PENDING')
test('submitApplication returns Application with all input fields mapped correctly')
test('submitApplication throws VALIDATION_ERROR when email is missing')
test('submitApplication throws VALIDATION_ERROR when email format is invalid — no @ sign')
test('submitApplication throws VALIDATION_ERROR when mockSsn is not exactly 5 characters')
test('submitApplication throws VALIDATION_ERROR when mockSsn contains non-digit characters')
test('submitApplication throws VALIDATION_ERROR when annualIncome is zero')
test('submitApplication throws VALIDATION_ERROR when annualIncome is negative')
test('submitApplication throws VALIDATION_ERROR when dateOfBirth is not a valid calendar date')
test('submitApplication throws DUPLICATE_APPLICATION when PENDING application exists for email')
test('submitApplication throws DUPLICATE_APPLICATION when APPROVED application exists for email')
test('submitApplication throws DUPLICATE_APPLICATION when ACTIVE account exists for email')
test('submitApplication throws DUPLICATE_APPLICATION when SUSPENDED account exists for email')
test('submitApplication allows submission when only DECLINED application exists for email')
test('submitApplication allows submission when only CLOSED account exists for email')
test('submitApplication publishes APPLICATION_SUBMITTED event to SNS client')
test('getApplication returns Application for valid applicationId')
test('getApplication throws APPLICATION_NOT_FOUND for unknown applicationId')
test('getApplication throws VALIDATION_ERROR for non-UUID applicationId')
test('runCreditCheck declines application when mockSsn starts and ends with 5 — 54315')
test('runCreditCheck declines application when mockSsn starts and ends with 5 — 50905')
test('runCreditCheck declines application when mockSsn starts and ends with 5 — 55555')
test('runCreditCheck approves application when mockSsn does not match decline rule — 12345')
test('runCreditCheck approves application when mockSsn starts with 5 but does not end with 5 — 51234')
test('runCreditCheck sets application status to DECLINED and stamps decidedAt on decline')
test('runCreditCheck sets application status to APPROVED and stamps decidedAt on approval')
test('runCreditCheck computes creditLimit as annualIncome * 0.10 rounded — income 75000 yields 7500')
test('runCreditCheck computes creditLimit floored at 500 — income 3000 yields 500')
test('runCreditCheck computes creditLimit capped at 15000 — income 200000 yields 15000')
test('runCreditCheck creates Account with currentBalance 500.00 on approval')
test('runCreditCheck creates Account with availableCredit equal to creditLimit minus 500')
test('runCreditCheck creates Account with paymentDueDate on 25th of the month following creation')
test('runCreditCheck creates Account with paymentDueDate rolling into January when created in December')
test('runCreditCheck creates PaymentDueSchedule atomically with Account on approval')
test('runCreditCheck creates NotificationPreference with all three fields defaulting to true on approval')
test('runCreditCheck publishes APPLICATION_DECIDED event with decision DECLINED to SNS client')
test('runCreditCheck publishes APPLICATION_DECIDED event with decision APPROVED and accountId to SNS client')
test('runCreditCheck throws APPLICATION_NOT_FOUND for unknown applicationId')
test('runCreditCheck does not create Account when application is declined')
test('runCreditCheck rollback — no Account row exists if transaction fails after account insert')
```

### `tests/emails/decline.template.test.ts`
```
test('buildDeclineEmail sets to field to applicant email')
test('buildDeclineEmail subject references PixiCred application')
test('buildDeclineEmail body includes note that applicant may reapply')
test('buildDeclineEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/emails/approval.template.test.ts`
```
test('buildApprovalEmail sets to field to applicant email')
test('buildApprovalEmail subject indicates approval')
test('buildApprovalEmail body includes credit limit')
test('buildApprovalEmail body labels accountId as Account Setup Code')
test('buildApprovalEmail body includes link or reference to pixicred.com/setup')
test('buildApprovalEmail body includes opening balance of 500')
test('buildApprovalEmail body includes payment due date from account.paymentDueDate')
test('buildApprovalEmail uses SES_FROM_EMAIL env var as sender when set')
```

### `tests/handlers/applications.handler.test.ts`
```
test('POST /applications returns 201 with PENDING application on valid input')
test('POST /applications returns 400 when email is missing')
test('POST /applications returns 400 when mockSsn is not a string of 5 characters')
test('POST /applications returns 400 when annualIncome is not a number')
test('POST /applications returns 409 DUPLICATE_APPLICATION when active record exists for email')
test('GET /applications/:applicationId returns 200 with application data')
test('GET /applications/:applicationId returns 404 APPLICATION_NOT_FOUND for unknown id')
test('GET /applications/:applicationId returns 400 VALIDATION_ERROR for non-UUID id')
```

### `tests/handlers/credit-check.handler.test.ts`
```
test('credit-check handler invokes runCreditCheck for each SQS record')
test('credit-check handler acknowledges message for approved SSN without throwing')
test('credit-check handler acknowledges message for declined SSN without throwing')
test('full flow: submit application enqueues SQS message, credit check runs, account created for approval SSN')
test('full flow: submit application enqueues SQS message, credit check runs, no account created for decline SSN')
```

---

## Done When
- [x] `submitApplication` passes all validation and duplicate-check tests
- [x] `runCreditCheck` correctly applies mock SSN rule for all vectors in CLAUDE.md
- [x] Credit limit formula matches FR-APP-07 exactly: floor $500, cap $15,000, rounded to nearest dollar
- [x] Payment due date formula matches FR-ACC-07: 25th of next month, rolls over December → January
- [x] `Account`, `PaymentDueSchedule`, and `NotificationPreference` created atomically in one transaction
- [x] `account.paymentDueDate` equals `paymentDueSchedule.paymentDueDate` for every created account — FR-DUE-05 denormalization is consistent
- [x] `runCreditCheck` publishes events to SNS — does NOT call email functions directly
- [x] Approval email body includes `account.accountId` labelled as "Account Setup Code" with link to `https://pixicred.com/setup` (FR-AUTH-07)
- [x] Email templates include all fields required by FR-EMAIL-01 and FR-EMAIL-02
- [x] All service unit tests pass against Testcontainers Postgres
- [x] All handler integration tests pass (unit tests with mocked serviceClient)
- [ ] Full async flow test (submit → SQS → credit check → decision) passes against MiniStack
- [x] Spec status updated to ✅ Implemented
- [x] `specs/02-service-layer-foundation.md` stubs for `submitApplication`, `getApplication`, `runCreditCheck` marked replaced
- [x] IMPLEMENTATION_PLAN.md Phase 2 row marked complete
