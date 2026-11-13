CREATE TABLE "StorageCandidate" (
  "key" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "collectAfter" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StorageCandidate_collectAfter_key_idx" ON "StorageCandidate" ("collectAfter", "key");
CREATE INDEX "Attachment_thumbnailKey_idx" ON "Attachment" ("thumbnailKey") WHERE "thumbnailKey" IS NOT NULL;
