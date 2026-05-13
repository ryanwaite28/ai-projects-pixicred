# Spec: Data Model — Prisma Schema & Type Definitions
**FR references**: FR-APP-01, FR-APP-02, FR-APP-03, FR-ACC-02, FR-ACC-03, FR-ACC-06, FR-ACC-07, FR-ACC-08, FR-DUE-01, FR-DUE-02, FR-TXN-01, FR-STMT-03, FR-NOTIF-01, FR-PAY-01, FR-BILL-07
**Status**: ✅ Implemented

---

## What

Phase 1a defines the complete Prisma schema for PixiCred's six core domain models (`Application`, `Account`, `PaymentDueSchedule`, `Transaction`, `Statement`, `NotificationPreference`), runs `prisma migrate dev` to produce the initial migration, and defines all TypeScript domain interfaces in `src/types/index.ts`. No query functions and no service logic are implemented here.

---

## Why

Every subsequent phase depends on a correct, migrated schema and a set of shared TypeScript interfaces. Establishing the schema independently lets Phase 1b focus exclusively on the query layer without mixing concerns.

---

## New / Modified Files

- `prisma/schema.prisma` — complete schema; replaces Phase 0 skeleton stubs; `binaryTargets` set for Lambda compatibility
- `src/types/index.ts` — TypeScript interfaces for all six domain entities; status enums; input/payload types

---

## Behavior

### `prisma/schema.prisma`

Must match PROJECT.md Section 7.1 field-for-field:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-1.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Application {
  applicationId String    @id @default(uuid()) @map("application_id") @db.Uuid
  email         String
  firstName     String    @map("first_name")
  lastName      String    @map("last_name")
  dateOfBirth   DateTime  @map("date_of_birth") @db.Date
  annualIncome  Decimal   @map("annual_income") @db.Decimal(12, 2)
  mockSsn       String    @map("mock_ssn") @db.Char(5)
  status        String    @default("PENDING")
  creditLimit   Decimal?  @map("credit_limit") @db.Decimal(10, 2)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  decidedAt     DateTime? @map("decided_at") @db.Timestamptz(6)

  account Account?

  @@index([email])
  @@index([status])
  @@map("applications")
}

model Account {
  accountId      String    @id @default(uuid()) @map("account_id") @db.Uuid
  applicationId  String    @unique @map("application_id") @db.Uuid
  holderEmail    String    @map("holder_email")
  creditLimit    Decimal   @map("credit_limit") @db.Decimal(10, 2)
  currentBalance Decimal   @default(500.00) @map("current_balance") @db.Decimal(10, 2)
  status         String    @default("ACTIVE")
  paymentDueDate DateTime  @map("payment_due_date") @db.Date
  closeReason    String?   @map("close_reason")
  closedAt       DateTime? @map("closed_at") @db.Timestamptz(6)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  application             Application             @relation(fields: [applicationId], references: [applicationId])
  paymentDueSchedule      PaymentDueSchedule?
  transactions            Transaction[]
  statements              Statement[]
  notificationPreferences NotificationPreference?

  @@index([holderEmail])
  @@index([status])
  @@index([paymentDueDate])
  @@map("accounts")
}

model PaymentDueSchedule {
  accountId        String    @id @map("account_id") @db.Uuid
  paymentDueDate   DateTime  @map("payment_due_date") @db.Date
  satisfied        Boolean   @default(false)
  satisfiedAt      DateTime? @map("satisfied_at") @db.Timestamptz(6)
  reminderSentDate DateTime? @map("reminder_sent_date") @db.Date
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  account Account @relation(fields: [accountId], references: [accountId])

  @@index([paymentDueDate])
  @@index([satisfied])
  @@map("payment_due_schedules")
}

model Transaction {
  transactionId  String   @id @default(uuid()) @map("transaction_id") @db.Uuid
  accountId      String   @map("account_id") @db.Uuid
  type           String
  merchantName   String?  @map("merchant_name")
  amount         Decimal  @db.Decimal(10, 2)
  idempotencyKey String   @map("idempotency_key")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  account Account @relation(fields: [accountId], references: [accountId])

  @@index([accountId])
  @@unique([accountId, idempotencyKey])
  @@map("transactions")
}

model Statement {
  statementId       String   @id @default(uuid()) @map("statement_id") @db.Uuid
  accountId         String   @map("account_id") @db.Uuid
  periodStart       DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd         DateTime @map("period_end") @db.Timestamptz(6)
  openingBalance    Decimal  @map("opening_balance") @db.Decimal(10, 2)
  closingBalance    Decimal  @map("closing_balance") @db.Decimal(10, 2)
  totalCharges      Decimal  @map("total_charges") @db.Decimal(10, 2)
  totalPayments     Decimal  @map("total_payments") @db.Decimal(10, 2)
  minimumPaymentDue Decimal  @map("minimum_payment_due") @db.Decimal(10, 2)
  dueDate           DateTime @map("due_date") @db.Date
  generatedAt       DateTime @default(now()) @map("generated_at") @db.Timestamptz(6)

  account Account @relation(fields: [accountId], references: [accountId])

  @@index([accountId])
  @@unique([accountId, periodStart, periodEnd])
  @@map("statements")
}

model NotificationPreference {
  accountId               String   @id @map("account_id") @db.Uuid
  transactionsEnabled     Boolean  @default(true) @map("transactions_enabled")
  statementsEnabled       Boolean  @default(true) @map("statements_enabled")
  paymentRemindersEnabled Boolean  @default(true) @map("payment_reminders_enabled")
  updatedAt               DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  account Account @relation(fields: [accountId], references: [accountId])

  @@map("notification_preferences")
}
```

### `src/types/index.ts`

```typescript
export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'DECLINED';
export type AccountStatus     = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type TransactionType   = 'CHARGE' | 'PAYMENT';
export type CloseReason       = 'USER_REQUESTED' | 'AUTO_NONPAYMENT';

export interface Application {
  applicationId:  string;
  email:          string;
  firstName:      string;
  lastName:       string;
  dateOfBirth:    string;   // ISO date YYYY-MM-DD
  annualIncome:   number;
  mockSsn:        string;
  status:         ApplicationStatus;
  creditLimit:    number | null;
  createdAt:      Date;
  decidedAt:      Date | null;
}

export interface Account {
  accountId:       string;
  applicationId:   string;
  holderEmail:     string;
  creditLimit:     number;
  currentBalance:  number;
  availableCredit: number;  // derived: creditLimit - currentBalance; never persisted
  status:          AccountStatus;
  paymentDueDate:  string;  // ISO date YYYY-MM-DD
  closeReason:     CloseReason | null;
  closedAt:        Date | null;
  createdAt:       Date;
}

export interface PaymentDueSchedule {
  accountId:        string;
  paymentDueDate:   string;  // ISO date YYYY-MM-DD
  satisfied:        boolean;
  satisfiedAt:      Date | null;
  reminderSentDate: string | null;  // ISO date YYYY-MM-DD
  createdAt:        Date;
}

export interface Transaction {
  transactionId:  string;
  accountId:      string;
  type:           TransactionType;
  merchantName:   string | null;
  amount:         number;
  idempotencyKey: string;
  createdAt:      Date;
}

export interface Statement {
  statementId:       string;
  accountId:         string;
  periodStart:       Date;
  periodEnd:         Date;
  openingBalance:    number;
  closingBalance:    number;
  totalCharges:      number;
  totalPayments:     number;
  minimumPaymentDue: number;
  dueDate:           string;  // ISO date YYYY-MM-DD
  generatedAt:       Date;
  transactions:      Transaction[];  // populated on detail fetch only
}

export interface NotificationPreference {
  accountId:               string;
  transactionsEnabled:     boolean;
  statementsEnabled:       boolean;
  paymentRemindersEnabled: boolean;
  updatedAt:               Date;
}
```

---

## Done When
- [x] `prisma/schema.prisma` models match PROJECT.md Section 7.1 field-for-field (six core models only; `portal_accounts` added in Phase 9)
- [x] `prisma migrate dev` produces a migration file and exits 0 against local Postgres
- [x] `prisma generate` produces PrismaClient with all six model types
- [x] `npm run db:migrate` (`prisma migrate deploy`) applies against a fresh Postgres and exits 0
- [x] All TypeScript interfaces in `src/types/index.ts` compile under strict mode with no implicit `any`
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 1a row marked complete
