# Spec: Service Layer Foundation
**FR references**: NFR-04, NFR-07, NFR-09 (infrastructure wiring — no behavioral FRs; all domain FRs are implemented in subsequent phase specs)
**Status**: 🔄 In Progress

---

## What

Phase 1 (part 2) wires together the runtime plumbing that every subsequent phase depends on: the `ServiceAction` discriminated union and routing dispatcher in `service.handler.ts`; all six service module skeletons with typed no-op stubs for every action; `service.client.ts` with dual-mode invocation (AWS Lambda SDK in production, HTTP in local dev); `local/service-server.ts` (Express, port 3001) that exposes the service layer locally; and the cross-cutting patterns that must be consistent across all phases — the structured error type, the log format, the response envelope, and the idempotency UUID guard. All stubs throw `NOT_IMPLEMENTED` until the phase specs that own them are approved and built.

---

## Why

NFR-09 mandates a service layer that is the single point of entry for all business logic. NFR-04 requires it to be independently testable without Lambda events. NFR-07 requires structured JSON logging at every action boundary. Establishing this foundation in one phase guarantees every future phase inherits the same contract, error shape, and logging discipline.

---

## New / Modified Files

### Service module skeletons
- `src/service/application.service.ts` — stubs: `submitApplication`, `getApplication`, `runCreditCheck`
- `src/service/account.service.ts` — stubs: `getAccount`, `closeAccount`
- `src/service/transaction.service.ts` — stubs: `postCharge`, `getTransactions`
- `src/service/payment.service.ts` — stub: `postPayment`
- `src/service/statement.service.ts` — stubs: `generateStatement`, `generateAllStatements`, `getStatements`, `getStatement`
- `src/service/notification.service.ts` — stubs: `getNotificationPreferences`, `updateNotificationPreferences`, `sendDeclineEmail`, `sendApprovalEmail`, `sendTransactionEmail`, `sendStatementEmail`, `sendPaymentDueReminderEmail`, `sendAutoCloseEmail`, `sendUserCloseEmail`
- `src/service/billing-lifecycle.service.ts` — stub: `runBillingLifecycle`
- `src/service/auth.service.ts` — stubs: `registerPortalAccount`, `loginPortalAccount`

### Service handler (Lambda entry point)
- `src/handlers/service/service.handler.ts` — Lambda handler that receives a `ServiceAction`, routes to the correct service function, returns the result, logs every invocation

### Service client
- `src/clients/service.client.ts` — `invoke(action: ServiceAction): Promise<unknown>`; uses `LambdaClient` (`lambda:InvokeFunction`) when `ENVIRONMENT !== 'local'`, uses `fetch` (HTTP POST to `SERVICE_ENDPOINT`) when `ENVIRONMENT === 'local'`

### Infrastructure clients (thin wrappers — no logic)
- `src/clients/ses.client.ts` — `sendEmail(input: SendEmailInput): Promise<void>`; wraps `@aws-sdk/client-ses`; uses `AWS_ENDPOINT_URL` for local
- `src/clients/sns.client.ts` — `publishEvent(topicArn: string, eventType: string, payload: unknown): Promise<void>`; wraps `@aws-sdk/client-sns`
- `src/clients/sqs.client.ts` — `sendMessage(queueUrl: string, body: unknown): Promise<void>`; wraps `@aws-sdk/client-sqs`

### Local server
- `local/service-server.ts` — Express server on port 3001; single `POST /` route; parses body as `ServiceAction`, calls service routing dispatcher directly (no Lambda invoke), returns result as JSON

### Cross-cutting utilities
- `src/lib/errors.ts` — `PixiCredError` class and `ErrorCode` string union; `toHttpStatus(code: ErrorCode): number` mapping
- `src/lib/logger.ts` — `log(level, action, durationMs, meta?)` — emits `JSON.stringify({ level, action, durationMs, ...meta })` to stdout
- `src/lib/validate.ts` — `assertUuid(value: string, field: string): void` — throws `VALIDATION_ERROR` if value is not a valid UUID v4 format

### Tests
- `tests/service/service-routing.test.ts` — verifies the dispatcher routes each `action` string to its stub and returns the expected NOT_IMPLEMENTED error
- `tests/service/service-client.test.ts` — verifies local HTTP mode and Lambda invoke mode
- `tests/lib/errors.test.ts`
- `tests/lib/validate.test.ts`

---

## Behavior

### `src/lib/errors.ts`

```typescript
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_APPLICATION'
  | 'APPLICATION_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'INSUFFICIENT_CREDIT'
  | 'PAYMENT_EXCEEDS_BALANCE'
  | 'STATEMENT_NOT_FOUND'
  | 'ACCOUNT_ALREADY_CLOSED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_CREDENTIALS'
  | 'PORTAL_ACCOUNT_EXISTS'
  | 'PORTAL_ACCOUNT_NOT_ELIGIBLE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export class PixiCredError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) { super(message); this.name = 'PixiCredError'; }
}

// HTTP status mapping per PROJECT.md Section 8.4:
// VALIDATION_ERROR             → 400
// DUPLICATE_APPLICATION        → 409
// APPLICATION_NOT_FOUND        → 404
// ACCOUNT_NOT_FOUND            → 404
// ACCOUNT_NOT_ACTIVE           → 422
// INSUFFICIENT_CREDIT          → 422
// PAYMENT_EXCEEDS_BALANCE      → 422
// STATEMENT_NOT_FOUND          → 404
// ACCOUNT_ALREADY_CLOSED       → 422
// UNAUTHORIZED                 → 401
// FORBIDDEN                    → 403
// INVALID_CREDENTIALS          → 401
// PORTAL_ACCOUNT_EXISTS        → 409
// PORTAL_ACCOUNT_NOT_ELIGIBLE  → 422
// NOT_IMPLEMENTED              → 501
// INTERNAL_ERROR               → 500
export function toHttpStatus(code: ErrorCode): number { ... }
```

### `src/lib/logger.ts`

Every log line is a single JSON object on stdout:

```typescript
{
  level:      'info' | 'warn' | 'error';
  action:     string;       // ServiceAction.action value
  durationMs: number;       // wall time of the service call
  error?:     string;       // error.message when level = 'error'
  code?:      string;       // PixiCredError.code when level = 'error'
  [key: string]: unknown;   // additional structured fields
}
```

### `src/handlers/service/service.handler.ts`

```typescript
export const handler = async (event: ServiceAction): Promise<unknown> => {
  const start = Date.now();
  try {
    const result = await dispatch(event);
    log('info', event.action, Date.now() - start);
    return result;
  } catch (err) {
    if (err instanceof PixiCredError) {
      log('warn', event.action, Date.now() - start, { code: err.code, error: err.message });
      throw err;
    }
    log('error', event.action, Date.now() - start, { error: String(err) });
    throw new PixiCredError('INTERNAL_ERROR', 'Unexpected error');
  }
};
```

`dispatch(event: ServiceAction)` is a switch on `event.action` routing to the correct service function. Every action must have a case. Unrecognised actions throw `NOT_IMPLEMENTED`.

### `src/clients/service.client.ts`

```typescript
export interface ServiceClient {
  invoke<T = unknown>(action: ServiceAction): Promise<T>;
}
```

- **Local mode** (`ENVIRONMENT === 'local'`): `fetch(SERVICE_ENDPOINT, { method: 'POST', body: JSON.stringify(action) })` → if response contains `error`, throw `PixiCredError(error.code, error.message)` → else return `data`
- **Lambda mode**: `LambdaClient.send(new InvokeCommand({ FunctionName: SERVICE_LAMBDA_ARN, Payload: JSON.stringify(action) }))` → decode `Uint8Array` payload → if `FunctionError` present, parse and throw `PixiCredError` → else return parsed result

Both modes propagate `PixiCredError` to the caller intact so callers can catch `.code`.

### `local/service-server.ts`

```typescript
app.post('/', async (req, res) => {
  try {
    const result = await dispatch(req.body as ServiceAction);
    res.json({ data: result });
  } catch (err) {
    if (err instanceof PixiCredError) {
      res.status(toHttpStatus(err.code)).json({ error: { code: err.code, message: err.message } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
    }
  }
});
```

### Service module stubs

Every stub (example from `application.service.ts`):

```typescript
export async function submitApplication(
  _prisma: PrismaClient,
  _clients: ServiceClients,
  _input: SubmitApplicationInput
): Promise<Application> {
  throw new PixiCredError('NOT_IMPLEMENTED', 'submitApplication not yet implemented');
}
```

**`ServiceClients` interface** — injected into every service function to enable testing without env vars:

```typescript
export interface ServiceClients {
  sesClient: SesClient;
  snsClient: SnsClient;
  sqsClient: SqsClient;
}
```

All service functions accept `(prisma: PrismaClient, clients: ServiceClients, input: ...)` as their first three parameters. The dispatcher in `service.handler.ts` imports the PrismaClient singleton from `src/db/client.ts`, constructs real AWS clients from env vars, and passes them in. Tests inject fakes (a Testcontainers-backed PrismaClient for the DB, stub objects for SES/SNS/SQS).

### `src/lib/validate.ts`

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new PixiCredError('VALIDATION_ERROR', `${field} must be a valid UUID v4`);
  }
}
```

### `ServiceAction` type (added to `src/types/index.ts`)

```typescript
export type ServiceAction =
  | { action: 'submitApplication';             payload: SubmitApplicationInput }
  | { action: 'getApplication';                payload: { applicationId: string } }
  | { action: 'runCreditCheck';                payload: { applicationId: string } }
  | { action: 'getAccount';                    payload: { accountId: string } }
  | { action: 'closeAccount';                  payload: { accountId: string; reason: 'USER_REQUESTED' | 'AUTO_NONPAYMENT' } }
  | { action: 'postCharge';                    payload: PostChargeInput }
  | { action: 'postPayment';                   payload: PostPaymentInput }
  | { action: 'getTransactions';               payload: GetTransactionsInput }
  | { action: 'generateStatement';             payload: { accountId: string } }
  | { action: 'generateAllStatements';         payload: { period: 'weekly' | 'monthly' } }
  | { action: 'getStatements';                 payload: { accountId: string } }
  | { action: 'getStatement';                  payload: { accountId: string; statementId: string } }
  | { action: 'getNotificationPreferences';    payload: { accountId: string } }
  | { action: 'updateNotificationPreferences'; payload: UpdateNotificationPrefsInput }
  | { action: 'sendDeclineEmail';              payload: { applicationId: string } }
  | { action: 'sendApprovalEmail';             payload: { applicationId: string } }
  | { action: 'sendTransactionEmail';          payload: { transactionId: string } }
  | { action: 'sendStatementEmail';            payload: { statementId: string } }
  | { action: 'sendPaymentDueReminderEmail';   payload: { accountId: string } }
  | { action: 'sendAutoCloseEmail';            payload: { accountId: string } }
  | { action: 'sendUserCloseEmail';            payload: { accountId: string } }
  | { action: 'runBillingLifecycle';           payload: { lookaheadDays: number } }
  | { action: 'registerPortalAccount';        payload: { email: string; accountId: string; password: string } }
  | { action: 'loginPortalAccount';           payload: { email: string; password: string } };
```

---

## Exact Test Cases

### `tests/service/service-routing.test.ts`
```
test('dispatch throws NOT_IMPLEMENTED for submitApplication stub')
test('dispatch throws NOT_IMPLEMENTED for getApplication stub')
test('dispatch throws NOT_IMPLEMENTED for runCreditCheck stub')
test('dispatch throws NOT_IMPLEMENTED for getAccount stub')
test('dispatch throws NOT_IMPLEMENTED for closeAccount stub')
test('dispatch throws NOT_IMPLEMENTED for postCharge stub')
test('dispatch throws NOT_IMPLEMENTED for postPayment stub')
test('dispatch throws NOT_IMPLEMENTED for getTransactions stub')
test('dispatch throws NOT_IMPLEMENTED for generateStatement stub')
test('dispatch throws NOT_IMPLEMENTED for generateAllStatements stub')
test('dispatch throws NOT_IMPLEMENTED for getStatements stub')
test('dispatch throws NOT_IMPLEMENTED for getStatement stub')
test('dispatch throws NOT_IMPLEMENTED for getNotificationPreferences stub')
test('dispatch throws NOT_IMPLEMENTED for updateNotificationPreferences stub')
test('dispatch throws NOT_IMPLEMENTED for sendDeclineEmail stub')
test('dispatch throws NOT_IMPLEMENTED for sendApprovalEmail stub')
test('dispatch throws NOT_IMPLEMENTED for sendTransactionEmail stub')
test('dispatch throws NOT_IMPLEMENTED for sendStatementEmail stub')
test('dispatch throws NOT_IMPLEMENTED for sendPaymentDueReminderEmail stub')
test('dispatch throws NOT_IMPLEMENTED for sendAutoCloseEmail stub')
test('dispatch throws NOT_IMPLEMENTED for sendUserCloseEmail stub')
test('dispatch throws NOT_IMPLEMENTED for runBillingLifecycle stub')
test('dispatch throws NOT_IMPLEMENTED for registerPortalAccount stub')
test('dispatch throws NOT_IMPLEMENTED for loginPortalAccount stub')
test('dispatch handler wraps unknown errors as INTERNAL_ERROR PixiCredError')
test('dispatch handler re-throws PixiCredError as-is without wrapping')
```

### `tests/service/service-client.test.ts`
```
test('invoke in local mode sends POST to SERVICE_ENDPOINT with serialized action body')
test('invoke in local mode returns data field from successful response')
test('invoke in local mode throws PixiCredError with correct code when response contains error field')
test('invoke in lambda mode calls LambdaClient InvokeCommand with serialized payload')
test('invoke in lambda mode returns decoded result on success')
test('invoke in lambda mode throws PixiCredError when FunctionError is present in response')
```

### `tests/lib/errors.test.ts`
```
test('PixiCredError has name PixiCredError')
test('PixiCredError stores code and message')
test('toHttpStatus returns 400 for VALIDATION_ERROR')
test('toHttpStatus returns 409 for DUPLICATE_APPLICATION')
test('toHttpStatus returns 404 for APPLICATION_NOT_FOUND')
test('toHttpStatus returns 404 for ACCOUNT_NOT_FOUND')
test('toHttpStatus returns 422 for ACCOUNT_NOT_ACTIVE')
test('toHttpStatus returns 422 for INSUFFICIENT_CREDIT')
test('toHttpStatus returns 422 for PAYMENT_EXCEEDS_BALANCE')
test('toHttpStatus returns 404 for STATEMENT_NOT_FOUND')
test('toHttpStatus returns 422 for ACCOUNT_ALREADY_CLOSED')
test('toHttpStatus returns 401 for UNAUTHORIZED')
test('toHttpStatus returns 403 for FORBIDDEN')
test('toHttpStatus returns 401 for INVALID_CREDENTIALS')
test('toHttpStatus returns 409 for PORTAL_ACCOUNT_EXISTS')
test('toHttpStatus returns 422 for PORTAL_ACCOUNT_NOT_ELIGIBLE')
test('toHttpStatus returns 501 for NOT_IMPLEMENTED')
test('toHttpStatus returns 500 for INTERNAL_ERROR')
```

### `tests/lib/validate.test.ts`
```
test('assertUuid passes for a valid UUID v4')
test('assertUuid throws VALIDATION_ERROR for an empty string')
test('assertUuid throws VALIDATION_ERROR for a UUID v1')
test('assertUuid throws VALIDATION_ERROR for a random non-UUID string')
test('assertUuid error message includes the field name')
```

---

## Done When
- [ ] All six service module skeletons compile under strict TypeScript with no implicit `any`
- [ ] All stubs throw `PixiCredError('NOT_IMPLEMENTED', ...)` — confirmed by routing tests
- [ ] `ServiceAction` discriminated union covers all 24 actions from PROJECT.md Section 6.2 (including `registerPortalAccount` and `loginPortalAccount`)
- [ ] `service.handler.ts` dispatcher has a case for every `ServiceAction.action` value
- [ ] `service.client.ts` dual-mode invocation confirmed by unit tests (Lambda mock + fetch mock)
- [ ] `local/service-server.ts` starts on port 3001 and returns `{ data }` / `{ error }` envelope
- [ ] `src/lib/errors.ts` — all 16 error codes present; `toHttpStatus` mapping verified by test
- [ ] `src/lib/validate.ts` — UUID guard confirmed by test
- [ ] `src/lib/logger.ts` — emits valid JSON to stdout (verified by capturing stdout in test)
- [ ] All tests in `tests/service/` and `tests/lib/` pass
- [ ] Spec status updated to ✅ Implemented
- [ ] IMPLEMENTATION_PLAN.md Phase 1 (part 2) row marked complete
- [ ] `specs/03-application-underwriting.md` through `specs/09-billing-lifecycle.md` reference `ServiceClients` injection pattern defined here
