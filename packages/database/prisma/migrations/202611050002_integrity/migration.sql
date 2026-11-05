ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_positive_version" CHECK ("version" > 0 AND "reopenCount" >= 0);
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_positive_size" CHECK ("expectedSize" > 0 AND ("size" IS NULL OR "size" > 0));
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append only';
END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
