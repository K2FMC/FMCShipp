-- CreateTable
CREATE TABLE "SyncState" (
    "shop" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("shop")
);
