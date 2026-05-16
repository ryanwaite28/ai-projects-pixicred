# Spec: Transaction Settlement Job (Phase 12c)
**FR references**: FR-TXN-12, FR-TXNJOB-01, FR-TXNJOB-02
**Status**: ✅ Implemented
**Prerequisite**: Phase 12b ✅ (PROCESSING status in place), Phase 4.5 ✅ (billing lifecycle job pattern established)

---

## What

Phase 12c implements the daily transaction settlement job. A scheduled EventBridge rule fires at 08:00 UTC (3:00 AM EST) every day, enqueues a message to the `transaction-settlement` SQS queue, and a new Lambda consumer calls `settleTransactions()` in the service layer. The service finds all `CHARGE` transactions with `status = 'PROCESSING'` where `created_at <= NOW() - 24 hours`, advances each to `status = 'POSTED'`, stamps `status_updated_at`, and publishes a `TRANSACTION_POSTED` SNS event per transaction. An on-demand admin endpoint `POST /admin/transaction-settlement` enqueues the same message for manual triggering.

---

## Why

FR-TXN-12 requires a daily job to simulate real-world transaction settlement (the T+1 banking settlement window). FR-TXNJOB-01/02 define the cron schedule and on-demand trigger.

---

## New / Modified Files

### Service layer
- `src/service/transaction.service.ts` — add `settleTransactions(prisma, clients, input: Record<string, never>): Promise<{ settled: number }>`

### Query layer
- `src/db/queries/transaction.queries.ts` — add `getProcessingChargesOlderThan(prisma, cutoff: Date): Promise<Transaction[]>` and `updateTransactionStatus(prisma, transactionId: string, status: TransactionStatus): Promise<Transaction>`

### Types
- `src/types/index.ts` — add `settleTransactions` and `resolveDisputes` entries to `ServiceAction` union (resolveDisputes added in Phase 12e; add placeholder here)

### Handlers
- `src/handlers/sqs/transaction-settlement.handler.ts` — NEW; SQS Lambda consumer; calls `settleTransactions()`
- `src/handlers/api/admin.handler.ts` — modified (from Phase 4.5 billing lifecycle); add route `POST /admin/transaction-settlement` that enqueues to `transaction-settlement-queue`
- `src/handlers/service/service.handler.ts` — add `settleTransactions` dispatch case

### Infrastructure (Terraform)
- `infra/terraform/envs/{dev,prod}/main.tf` — add `module "sqs_transaction_settlement"`, `module "lambda_transaction_settlement"`, `module "eventbridge_transaction_settlement"`

### Local development
- `infra/ministack/init.sh` — add `transaction-settlement-queue` + `transaction-settlement-dlq` creation
- `local/worker.ts` — add polling for `transaction-settlement-queue`

---

## Behavior

### `settleTransactions` service function

```typescript
export async function settleTransactions(
  prisma: PrismaClient,
  clients: ServiceClients,
  _input: Record<string, never>
): Promise<{ settled: number }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidates = await getProcessingChargesOlderThan(prisma, cutoff);
  let settled = 0;
  for (const tx of candidates) {
    await updateTransactionStatus(prisma, tx.transactionId, 'POSTED');
    await clients.sns.publish({
      topicArn: clients.config.snsTopicArn,
      message: JSON.stringify({ transactionId: tx.transactionId }),
      attributes: { eventType: 'TRANSACTION_POSTED' },
    });
    settled++;
  }
  return { settled };
}
```

- Processes transactions sequentially to avoid partial-batch SNS failures
- Returns `{ settled: N }` — logged by the handler for observability
- Idempotent: `getProcessingChargesOlderThan` filters by `status = 'PROCESSING'`; already-settled transactions are never selected again

### `getProcessingChargesOlderThan` query

```typescript
export async function getProcessingChargesOlderThan(
  prisma: PrismaClient,
  cutoff: Date
): Promise<Transaction[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      type:      'CHARGE',
      status:    'PROCESSING',
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(mapTransaction);
}
```

### `updateTransactionStatus` query

```typescript
export async function updateTransactionStatus(
  prisma: PrismaClient,
  transactionId: string,
  status: TransactionStatus
): Promise<Transaction> {
  const row = await prisma.transaction.update({
    where: { transactionId },
    data:  { status, statusUpdatedAt: new Date() },
  });
  return mapTransaction(row);
}
```

### SQS handler

```typescript
// src/handlers/sqs/transaction-settlement.handler.ts
export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const result = await serviceClient.invoke({
      action:  'settleTransactions',
      payload: {},
    });
    console.log(JSON.stringify({ level: 'info', action: 'settleTransactions', settled: result.settled }));
  }
};
```

### Admin endpoint addition

In `src/handlers/api/admin.handler.ts`, add:

```
POST /admin/transaction-settlement
  → enqueue empty message to TRANSACTION_SETTLEMENT_QUEUE_URL
  → return 202 { data: { message: 'Transaction settlement job enqueued' } }
```

### EventBridge cron

Schedule expression: `cron(0 8 * * ? *)` (08:00 UTC daily = 3:00 AM EST).

### SNS event published per settled transaction

```json
{
  "eventType": "TRANSACTION_POSTED",
  "transactionId": "<uuid>"
}
```

The notification Lambda handles `TRANSACTION_POSTED` for `CHARGE` type transactions by calling `sendChargePostedEmail` (Phase 12f).

---

## Done When

- [x] `settleTransactions` selects only PROCESSING CHARGE transactions older than 24h
- [x] Each selected transaction: `status = 'POSTED'`, `status_updated_at = NOW()`, `TRANSACTION_POSTED` SNS event published
- [x] Already-POSTED transactions excluded; function is idempotent
- [x] SQS Lambda handler invokes `settleTransactions` and logs result
- [x] `POST /admin/transaction-settlement` returns 202 and enqueues to `transaction-settlement-queue`
- [x] EventBridge cron `cron(0 8 * * ? *)` wired to `transaction-settlement-queue` in Terraform
- [x] `infra/ministack/init.sh` creates `transaction-settlement-queue` + DLQ
- [x] `local/worker.ts` polls `transaction-settlement-queue`
- [x] Unit tests: `settleTransactions` — happy path (N transactions settled), no-op if no candidates, idempotency
- [x] Integration test: enqueue message → handler → transactions advanced to POSTED
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12c row updated to ✅ Complete
