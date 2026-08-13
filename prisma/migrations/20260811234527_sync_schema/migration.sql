-- Baseline migration: records columns already present in the database
-- (added previously via `prisma db push` outside of migration history)
-- so `prisma migrate dev` no longer detects drift. No schema change is
-- executed by this migration on environments where it's marked resolved.
ALTER TABLE "CarrierConfig" ADD COLUMN     "senderConfig" TEXT;
ALTER TABLE "Label" ADD COLUMN     "cn23Data" TEXT;
