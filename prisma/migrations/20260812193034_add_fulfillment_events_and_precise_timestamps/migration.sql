-- AlterTable
ALTER TABLE "Fulfillment" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "estimatedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "inTransitAt" TIMESTAMP(3),
ADD COLUMN     "trackingEvents" TEXT;
