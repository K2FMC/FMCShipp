-- CreateTable
CREATE TABLE "OrderSignal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "link" TEXT,
    "customerEmail" TEXT,
    "orderNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderSignal_orderId_status_idx" ON "OrderSignal"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSignal_source_externalId_key" ON "OrderSignal"("source", "externalId");

-- AddForeignKey
ALTER TABLE "OrderSignal" ADD CONSTRAINT "OrderSignal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

