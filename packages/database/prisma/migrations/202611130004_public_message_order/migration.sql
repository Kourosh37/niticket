-- Shared by inbox/report latest-public-message lookups and public chat pagination.
CREATE INDEX "Message_public_ticket_created_idx"
  ON "Message" ("ticketId", "createdAt" DESC, "id" DESC) INCLUDE ("senderId")
  WHERE visibility = 'PUBLIC';
