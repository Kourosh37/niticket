ALTER TABLE "Session" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Session" SET "lastSeenAt"=LEAST("updatedAt",CURRENT_TIMESTAMP);
CREATE INDEX "Session_userId_createdAt_id_idx" ON "Session"("userId","createdAt","id");
