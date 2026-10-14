-- DropIndex
DROP INDEX "Label_status_handedOverAt_idx";

-- AlterTable
ALTER TABLE "Label" DROP COLUMN "handedOverAt",
DROP COLUMN "trackingCheckedAt";

-- AlterTable
ALTER TABLE "Fulfillment" ADD COLUMN "shippedAt" TIMESTAMP(3),
ADD COLUMN "handedOverAt" TIMESTAMP(3),
ADD COLUMN "trackingCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Fulfillment_status_handedOverAt_idx" ON "Fulfillment"("status", "handedOverAt");
