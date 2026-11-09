-- The first authorized counterparty view is immutable at application level.
-- Bounded receipt batches use the existing message primary key and ticket indexes.
ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);
