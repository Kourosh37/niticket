-- Keep unread reply checks scoped to one conversation, without scanning its full history.
CREATE INDEX "Message_unread_public_ticket_sender_idx" ON "Message" ("ticketId", "senderId")
  WHERE visibility = 'PUBLIC' AND "readAt" IS NULL;
