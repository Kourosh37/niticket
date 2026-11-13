CREATE INDEX "OutboxEvent_completed_retention_idx"
ON "OutboxEvent" ("processedAt", id)
WHERE "processedAt" IS NOT NULL AND "failedAt" IS NULL;
