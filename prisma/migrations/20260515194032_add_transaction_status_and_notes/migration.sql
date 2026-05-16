-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PROCESSING',
ADD COLUMN     "status_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: existing PAYMENT rows should be POSTED, not PROCESSING
UPDATE "transactions" SET "status" = 'POSTED' WHERE "type" = 'PAYMENT';

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");
