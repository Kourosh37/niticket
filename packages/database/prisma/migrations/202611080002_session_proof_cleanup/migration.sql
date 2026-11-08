DELETE FROM "Reauthentication" r WHERE NOT EXISTS (SELECT 1 FROM "Session" s WHERE s.id=r."sessionId");
ALTER TABLE "Reauthentication" ADD CONSTRAINT "Reauthentication_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
