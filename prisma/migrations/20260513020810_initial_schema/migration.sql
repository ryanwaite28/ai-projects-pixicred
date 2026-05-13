-- CreateTable
CREATE TABLE "applications" (
    "application_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "annual_income" DECIMAL(12,2) NOT NULL,
    "mock_ssn" CHAR(5) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "credit_limit" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("application_id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "account_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "holder_email" TEXT NOT NULL,
    "credit_limit" DECIMAL(10,2) NOT NULL,
    "current_balance" DECIMAL(10,2) NOT NULL DEFAULT 500.00,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payment_due_date" DATE NOT NULL,
    "close_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "payment_due_schedules" (
    "account_id" UUID NOT NULL,
    "payment_due_date" DATE NOT NULL,
    "satisfied" BOOLEAN NOT NULL DEFAULT false,
    "satisfied_at" TIMESTAMPTZ(6),
    "reminder_sent_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_due_schedules_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "merchant_name" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "statements" (
    "statement_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "opening_balance" DECIMAL(10,2) NOT NULL,
    "closing_balance" DECIMAL(10,2) NOT NULL,
    "total_charges" DECIMAL(10,2) NOT NULL,
    "total_payments" DECIMAL(10,2) NOT NULL,
    "minimum_payment_due" DECIMAL(10,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("statement_id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "account_id" UUID NOT NULL,
    "transactions_enabled" BOOLEAN NOT NULL DEFAULT true,
    "statements_enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment_reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE INDEX "applications_email_idx" ON "applications"("email");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_application_id_key" ON "accounts"("application_id");

-- CreateIndex
CREATE INDEX "accounts_holder_email_idx" ON "accounts"("holder_email");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "accounts_payment_due_date_idx" ON "accounts"("payment_due_date");

-- CreateIndex
CREATE INDEX "payment_due_schedules_payment_due_date_idx" ON "payment_due_schedules"("payment_due_date");

-- CreateIndex
CREATE INDEX "payment_due_schedules_satisfied_idx" ON "payment_due_schedules"("satisfied");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_idempotency_key_key" ON "transactions"("account_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "statements_account_id_idx" ON "statements"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "statements_account_id_period_start_period_end_key" ON "statements"("account_id", "period_start", "period_end");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_due_schedules" ADD CONSTRAINT "payment_due_schedules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
