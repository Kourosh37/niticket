ALTER TABLE "OutboxEvent" ADD COLUMN "failedAt" TIMESTAMP(3);
CREATE INDEX "OutboxEvent_processedAt_failedAt_createdAt_idx" ON "OutboxEvent" ("processedAt", "failedAt", "createdAt");
DROP INDEX "OutboxEvent_processedAt_createdAt_idx";
