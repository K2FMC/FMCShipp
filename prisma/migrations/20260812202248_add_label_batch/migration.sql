-- AlterTable
ALTER TABLE "Label" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "LabelBatch" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "mergedPdf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelBatch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LabelBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
