ALTER TABLE "NotificationDelivery" ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery" ("status", "nextAttemptAt");
