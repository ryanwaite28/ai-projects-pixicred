# Spec: Transaction Status — Schema & Data Model (Phase 12a)
**FR references**: FR-TXN-09, FR-TXN-10, FR-TXN-14
**Status**: ✅ Implemented
**Prerequisite**: Phase 3b ✅ (transactions table + postCharge), Phase 4 ✅ (payment.service.ts + postPayment), Phase 11b ✅ (postMerchantCharge; all prior transaction code tested)

---

## What

Phase 12a adds a `status` column, a `status_updated_at` column, and a nullable `notes` column to the `transactions` table. It extends the `Transaction` TypeScript interface and updates every code path that creates a transaction to supply an initial status. All existing charge creation paths default to `PROCESSING`; all payment creation paths default to `POSTED`. No behavior logic changes in this phase — that is Phase 12b.

---

## Why

FR-TXN-09 requires all transactions to carry an explicit status field with a defined lifecycle. FR-TXN-10 establishes that payment transactions are immediately `POSTED` while charge transactions start as `PROCESSING` (or `DENIED`, handled in Phase 12b). FR-TXN-14 adds an optional `notes` field for human-readable status context set by the service layer. This schema phase is a prerequisite for every subsequent transaction lifecycle phase (12b–12g).

---

## New / Modified Files

### Database
- `prisma/schema.prisma` — add `status String @default("PROCESSING")` and `statusUpdatedAt DateTime @default(now()) @map("status_updated_at")` to the `Transaction` model; add `@@index([status])` and `@@index([status, createdAt])`

### Types
- `src/types/index.ts` — add `TransactionStatus` union type; add `status` and `statusUpdatedAt` fields to `Transaction` interface

### Query layer
- `src/db/queries/transaction.queries.ts` — update `CreateTransactionInput` to include required `status` and optional `notes`; update `mapTransaction` to map `status`, `statusUpdatedAt`, and `notes`

### Service layer
- `src/service/transaction.service.ts` — pass `status: 'PROCESSING'` when creating charge transactions in `postCharge`; pass `status: 'POSTED'` when creating payment transactions in `postPayment` (called via `payment.service.ts`)
- `src/service/payment.service.ts` — pass `status: 'POSTED'` to `createTransaction` call

---

## Behavior

### Prisma schema addition

```prisma
model Transaction {
  transactionId   String   @id @default(uuid()) @map("transaction_id")
  accountId       String   @map("account_id")
  type            String
  merchantName    String?  @map("merchant_name")
  amount          Decimal  @db.Decimal(10, 2)
  idempotencyKey  String   @map("idempotency_key")
  status          String   @default("PROCESSING")
  statusUpdatedAt DateTime @default(now()) @map("status_updated_at")
  notes           String?
  createdAt       DateTime @default(now()) @map("created_at")

  account Account @relation(fields: [accountId], references: [accountId])

  @@unique([accountId, idempotencyKey])
  @@index([accountId])
  @@index([status])
  @@index([status, createdAt])
  @@map("transactions")
}
```

### TypeScript interface additions

```typescript
export type TransactionStatus =
  | 'PROCESSING'
  | 'POSTED'
  | 'DENIED'
  | 'DISPUTED'
  | 'DISPUTE_ACCEPTED'
  | 'DISPUTE_DENIED';

export interface Transaction {
  transactionId:   string;
  accountId:       string;
  type:            'CHARGE' | 'PAYMENT';
  merchantName:    string | null;
  amount:          number;
  idempotencyKey:  string;
  status:          TransactionStatus;   // NEW
  statusUpdatedAt: string;              // NEW — ISO 8601
  notes:           string | null;       // NEW — nullable
  createdAt:       string;
}
```

### `CreateTransactionInput` update

```typescript
export interface CreateTransactionInput {
  accountId:      string;
  type:           'CHARGE' | 'PAYMENT';
  merchantName?:  string;
  amount:         number;
  idempotencyKey: string;
  status:         TransactionStatus;   // NEW — required; no default in query layer
  notes?:         string;              // NEW — optional
}
```

`mapTransaction` maps the new columns from the Prisma result:

```typescript
statusUpdatedAt: row.statusUpdatedAt.toISOString(),
status:          row.status as TransactionStatus,
notes:           row.notes ?? null,
```

### Initial status assignment

- `postCharge` → passes `status: 'PROCESSING'` to `createTransaction` (DENIED logic added in Phase 12b)
- `postPayment` → passes `status: 'POSTED'` to `createTransaction`
- `postMerchantCharge` → delegates to `postCharge`; inherits `status: 'PROCESSING'` (DENIED logic added in Phase 12b)

### Migration

A new Prisma migration adds the two columns with defaults so all existing rows receive the correct values without backfill scripts:

```sql
ALTER TABLE transactions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'PROCESSING',
  ADD COLUMN status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN notes TEXT;

CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_status_created ON transactions(status, created_at);
```

Existing CHARGE rows default to `PROCESSING`; existing PAYMENT rows should be `POSTED`. Because all existing rows are demo/test data and no production data exists, a secondary UPDATE to set payments to `POSTED` is acceptable in the migration:

```sql
UPDATE transactions SET status = 'POSTED' WHERE type = 'PAYMENT';
```

---

## Done When

- [x] Prisma migration runs cleanly (`prisma migrate dev`); `transactions` table has `status` and `status_updated_at` columns
- [x] `status` index and `(status, created_at)` composite index created
- [x] Existing PAYMENT rows have `status = 'POSTED'`; existing CHARGE rows have `status = 'PROCESSING'`
- [x] `Transaction` TypeScript interface includes `status: TransactionStatus`, `statusUpdatedAt: string`, and `notes: string | null`
- [x] `TransactionStatus` union type defined in `src/types/index.ts`
- [x] `mapTransaction` maps all three new columns (`status`, `statusUpdatedAt`, `notes`) — fixed in both `transaction.queries.ts` and `statement.queries.ts`
- [x] `createTransaction` requires `status` and accepts optional `notes` in its input
- [x] `postCharge` passes `status: 'PROCESSING'`; `postPayment` passes `status: 'POSTED'`
- [x] `npm run typecheck` passes with no errors
- [x] All existing tests updated: `status` (and `notes` where relevant) added to every `createTransaction` call and every `Transaction` fixture in test files; all tests pass
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12a row updated to ✅ Complete
