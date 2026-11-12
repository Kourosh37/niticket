BEGIN;

-- PostgreSQL CHECK accepts UNKNOWN, so reject a missing size explicitly.
-- Discard incomplete optional derivatives; approved originals remain available.
UPDATE "Attachment"
SET "thumbnailKey" = NULL, "thumbnailSize" = NULL
WHERE ("thumbnailKey" IS NULL) <> ("thumbnailSize" IS NULL)
   OR "thumbnailSize" <= 0;

ALTER TABLE "Attachment"
  DROP CONSTRAINT "Attachment_thumbnail_size_check",
  ADD CONSTRAINT "Attachment_thumbnail_size_check"
    CHECK (("thumbnailKey" IS NULL AND "thumbnailSize" IS NULL)
      OR ("thumbnailKey" IS NOT NULL AND "thumbnailSize" IS NOT NULL AND "thumbnailSize" > 0));

COMMIT;
