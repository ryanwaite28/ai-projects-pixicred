-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "card_number" TEXT NOT NULL DEFAULT '',
ADD COLUMN "card_expiry" DATE NOT NULL DEFAULT '2029-01-01',
ADD COLUMN "card_cvv" TEXT NOT NULL DEFAULT '';

-- Remove defaults after backfill (new rows will always supply values)
ALTER TABLE "accounts" ALTER COLUMN "card_number" DROP DEFAULT;
ALTER TABLE "accounts" ALTER COLUMN "card_expiry" DROP DEFAULT;
ALTER TABLE "accounts" ALTER COLUMN "card_cvv" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_card_number_key" ON "accounts"("card_number");
