CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The indexed expression is shared by all search queries. No shadow copy of message data.
CREATE FUNCTION niticket_search_text(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(lower(normalize(value, NFKC)),
        'يىك٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ییک01234567890123456789'),
      U&'[\0640\064B-\065F\0670\06D6-\06ED]', '', 'g'),
    U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200F\2028-\202E\202F\205F\2066-\2069\3000\FEFF]+', ' ', 'g'));
$$;

CREATE INDEX "Message_search_body_idx" ON "Message" USING GIN (niticket_search_text(body) gin_trgm_ops);
CREATE INDEX "Attachment_search_filename_idx" ON "Attachment" USING GIN (niticket_search_text(filename) gin_trgm_ops)
  WHERE "scanStatus" = 'CLEAN' AND "messageId" IS NOT NULL;
CREATE INDEX "Attachment_search_message_idx" ON "Attachment" ("messageId")
  WHERE "scanStatus" = 'CLEAN' AND "messageId" IS NOT NULL;
CREATE INDEX "Message_createdAt_id_idx" ON "Message" ("createdAt", id);
CREATE INDEX "Message_senderId_createdAt_id_idx" ON "Message" ("senderId", "createdAt", id);
