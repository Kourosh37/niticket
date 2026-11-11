CREATE TABLE "SavedReply" (
  id TEXT NOT NULL PRIMARY KEY,
  "departmentId" TEXT NOT NULL REFERENCES "Department"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "creatorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX "SavedReply_departmentId_deletedAt_updatedAt_id_idx" ON "SavedReply" ("departmentId", "deletedAt", "updatedAt", id);
ALTER TABLE "Message" ADD COLUMN "savedReplyId" TEXT REFERENCES "SavedReply"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Message_savedReplyId_idx" ON "Message" ("savedReplyId");
ALTER TABLE "Attachment" ADD COLUMN "savedReplyId" TEXT REFERENCES "SavedReply"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Attachment_savedReplyId_archivedAt_idx" ON "Attachment" ("savedReplyId", "archivedAt");
-- Each sent attachment keeps its own authorization and immutable metadata, sharing only approved bytes.
DROP INDEX "Attachment_objectKey_key";
CREATE INDEX "Attachment_objectKey_idx" ON "Attachment" ("objectKey");
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_context_check";
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_context_check" CHECK (
  ("ticketId" IS NOT NULL AND "avatarOwnerId" IS NULL AND "savedReplyId" IS NULL)
  OR ("ticketId" IS NULL AND "messageId" IS NULL AND "noteId" IS NULL AND (
    ("avatarOwnerId" IS NOT NULL AND "savedReplyId" IS NULL)
    OR ("avatarOwnerId" IS NULL AND "savedReplyId" IS NOT NULL)
  ))
);
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_archive_context_check"
  CHECK ("archivedAt" IS NULL OR "savedReplyId" IS NOT NULL);
