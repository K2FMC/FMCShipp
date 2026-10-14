-- AlterTable
ALTER TABLE "Label" ADD COLUMN "handedOverAt" TIMESTAMP(3),
ADD COLUMN "trackingCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Label_status_handedOverAt_idx" ON "Label"("status", "handedOverAt");
