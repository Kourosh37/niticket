CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Ticket_subject_search_idx" ON "Ticket" USING GIN (subject gin_trgm_ops);
