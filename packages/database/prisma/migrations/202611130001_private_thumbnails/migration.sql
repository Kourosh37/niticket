ALTER TABLE "Attachment" ADD COLUMN "thumbnailKey" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "thumbnailSize" INTEGER;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_thumbnail_size_check"
  CHECK (("thumbnailKey" IS NULL AND "thumbnailSize" IS NULL)
    OR ("thumbnailKey" IS NOT NULL AND "thumbnailSize" > 0));
