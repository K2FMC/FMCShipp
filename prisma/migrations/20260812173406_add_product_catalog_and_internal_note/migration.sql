-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "internalNote" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION,
    "hsCode" TEXT,
    "originCountry" TEXT NOT NULL DEFAULT 'FR',
    "unitValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_shop_sku_key" ON "Product"("shop", "sku");
