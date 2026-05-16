# Spec: Dispute Resolution Job (Phase 12e)
**FR references**: FR-TXN-13, FR-TXNJOB-03, FR-TXNJOB-04
**Status**: ✅ Implemented
**Prerequisite**: Phase 12d ✅ (DISPUTED status exists), Phase 12f ✅ (dispute resolution email template exists)

---

## What

Phase 12e implements the daily dispute resolution job. A scheduled EventBridge rule fires at 06:00 UTC every day, enqueues a message to the `dispute-resolution` SQS queue, and a new Lambda consumer calls `resolveDisputes()` in the service layer. The service finds all `DISPUTED` transactions, randomly assigns each to `DISPUTE_ACCEPTED` or `DISPUTE_DENIED` (50/50), stamps `status_updated_at`, and publishes a `DISPUTE_RESOLVED` SNS event per transaction. An on-demand admin endpoint `POST /admin/dispute-resolution` enqueues the same message for manual triggering.

---

## Why

FR-TXN-13 and FR-TXNJOB-03/04 model a real-world dispute review process as a scheduled background job. The random resolution simulates the non-deterministic outcome of a real dispute review team. The job is idempotent because only `DISPUTED` transactions are selected.

---

## New / Modified Files

### Service layer
- `src/service/transaction.service.ts` — add `resolveDisputes(prisma, clients, input: Record<string, never>): Promise<{ resolved: number }>`

### Query layer
- `src/db/queries/transaction.queries.ts` — add `getDisputedTransactions(prisma): Promise<Transaction[]>`
- `src/db/queries/transaction.queries.ts` — reuse `updateTransactionStatus` (Phase 12c)

### Types
- `src/types/index.ts` — add `resolveDisputes` to `ServiceAction` union (placeholder added in Phase 12c spec; confirm it exists)

### Handlers
- `src/handlers/sqs/dispute-resolution.handler.ts` — NEW; SQS Lambda consumer; calls `resolveDisputes()`
- `src/handlers/api/admin.handler.ts` — add route `POST /admin/dispute-resolution`
- `src/handlers/service/service.handler.ts` — add `resolveDisputes` dispatch case

### Notification service
- `src/service/notification.service.ts` — add handler for `DISPUTE_RESOLVED` event → calls `sendDisputeResolutionEmail()` (always — not preference-gated per FR-NOTIF-07)

### Infrastructure (Terraform)
- `infra/terraform/envs/{dev,prod}/main.tf` — add `module "sqs_dispute_resolution"`, `module "lambda_dispute_resolution"`, `module "eventbridge_dispute_resolution"`

### Local development
- `infra/ministack/init.sh` — add `dispute-resolution-queue` + `dispute-resolution-dlq` creation
- `local/worker.ts` — add polling for `dispute-resolution-queue`

---

## Behavior

### `resolveDisputes` service function

```typescript
export async function resolveDisputes(
  prisma: PrismaClient,
  clients: ServiceClients,
  _input: Record<string, never>
): Promise<{ resolved: number }> {
  const candidates = await getDisputedTransactions(prisma);
  let resolved = 0;
  for (const tx of candidates) {
    const outcome: TransactionStatus =
      Math.random() < 0.5 ? 'DISPUTE_ACCEPTED' : 'DISPUTE_DENIED';
    await updateTransactionStatus(prisma, tx.transactionId, outcome);
    await clients.sns.publish({
      topicArn:   clients.config.snsTopicArn,
      message:    JSON.stringify({ transactionId: tx.transactionId, outcome }),
      attributes: { eventType: 'DISPUTE_RESOLVED' },
    });
    resolved++;
  }
  return { resolved };
}
```

- Random 50/50 split using `Math.random() < 0.5`
- Processes sequentially to avoid partial-batch issues
- Idempotent: `getDisputedTransactions` selects only `status = 'DISPUTED'`

### `getDisputedTransactions` query

```typescript
export async function getDisputedTransactions(
  prisma: PrismaClient
): Promise<Transaction[]> {
  const rows = await prisma.transaction.findMany({
    where:   { status: 'DISPUTED' },
    orderBy: { statusUpdatedAt: 'asc' },
  });
  return rows.map(mapTransaction);
}
```

### SNS event published per resolved transaction

```json
{
  "eventType": "DISPUTE_RESOLVED",
  "transactionId": "<uuid>",
  "outcome": "DISPUTE_ACCEPTED"   // or "DISPUTE_DENIED"
}
```

The notification Lambda routes `DISPUTE_RESOLVED` to `sendDisputeResolutionEmail`, passing both `transactionId` and `outcome` so the email template can show the correct result.

### Notification routing

```typescript
case 'DISPUTE_RESOLVED':
  // No preference check — always send (FR-NOTIF-07)
  await sendDisputeResolutionEmail(prisma, clients, {
    transactionId: event.transactionId,
    outcome:       event.outcome,   // 'DISPUTE_ACCEPTED' | 'DISPUTE_DENIED'
  });
  break;
```

### SQS handler

```typescript
// src/handlers/sqs/dispute-resolution.handler.ts
export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const result = await serviceClient.invoke({
      action:  'resolveDisputes',
      payload: {},
    });
    console.log(JSON.stringify({ level: 'info', action: 'resolveDisputes', resolved: result.resolved }));
  }
};
```

### Admin endpoint addition

In `src/handlers/api/admin.handler.ts`, add:

```
POST /admin/dispute-resolution
  → enqueue empty message to DISPUTE_RESOLUTION_QUEUE_URL
  → return 202 { data: { message: 'Dispute resolution job enqueued' } }
```

### EventBridge cron

Schedule expression: `cron(0 6 * * ? *)` (06:00 UTC daily).

---

## Done When

- [x] `resolveDisputes` selects only DISPUTED transactions
- [x] Each resolved transaction: randomly assigned `DISPUTE_ACCEPTED` or `DISPUTE_DENIED`, `status_updated_at = NOW()`, `DISPUTE_RESOLVED` SNS event published with `outcome` in message body
- [x] Already-resolved transactions excluded; function is idempotent
- [x] SQS Lambda handler invokes `resolveDisputes` and logs result
- [x] `POST /admin/dispute-resolution` returns 202 and enqueues to `dispute-resolution-queue`
- [x] EventBridge cron `cron(0 6 * * ? *)` wired to `dispute-resolution-queue` in Terraform
- [x] `infra/ministack/init.sh` creates `dispute-resolution-queue` + DLQ
- [x] `local/worker.ts` polls `dispute-resolution-queue`
- [x] Notification service routes `DISPUTE_RESOLVED` to `sendDisputeResolutionEmail` without preference gating
- [x] Unit tests: `resolveDisputes` — happy path N resolutions, no-op if no candidates, both ACCEPTED and DENIED outcomes exercised
- [x] Integration test: disputed transactions resolved after job runs
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12e row updated to ✅ Complete
