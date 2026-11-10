ALTER TABLE "Notification" ADD COLUMN "messageId" TEXT;

-- Older outbox events predate explicit message IDs. Resolve them by their
-- conversation, author and transaction timestamp, without linking status events.
UPDATE "Notification" n SET "messageId" = (
  SELECT m.id FROM "Message" m
  WHERE m."ticketId" = n."ticketId"
    AND m."senderId" = e.payload->>'actorId'
    AND m.visibility = 'PUBLIC'
    AND m."createdAt" <= e."createdAt"
  ORDER BY m."createdAt" DESC, m.id DESC
  LIMIT 1
)
FROM "OutboxEvent" e
WHERE e.id = n."eventId"
  AND e.type = 'TICKET_NOTIFICATION'
  AND e.payload->>'type' IN ('TICKET_CREATED', 'PUBLIC_REPLY');

-- Preserve existing first-view timestamps for replies already seen by students.
UPDATE "Notification" n SET "readAt" = m."readAt"
FROM "Message" m JOIN "Ticket" t ON t.id = m."ticketId"
JOIN "User" u ON u.id = t."creatorId"
WHERE n."messageId" = m.id AND n."userId" = t."creatorId"
  AND u.role = 'STUDENT' AND NOT u."isAdmin"
  AND m."senderId" <> t."creatorId" AND m.visibility = 'PUBLIC'
  AND n."readAt" IS NULL AND m."readAt" IS NOT NULL;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Notification_userId_ticketId_readAt_messageId_idx"
  ON "Notification" ("userId", "ticketId", "readAt", "messageId");
