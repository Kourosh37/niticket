ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT, ADD COLUMN "phoneNumberVerified" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the original contact field. Ambiguous or invalid numbers are never
-- assigned to a login identity automatically.
WITH digits AS (
  SELECT id, regexp_replace(translate(COALESCE(phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') AS value FROM "User"
), normalized AS (
  SELECT id, CASE
    WHEN value ~ '^09[0-9]{9}$' THEN '+98' || substring(value FROM 2)
    WHEN value ~ '^989[0-9]{9}$' THEN '+' || value
    WHEN value ~ '^00989[0-9]{9}$' THEN '+' || substring(value FROM 3)
    WHEN value ~ '^9[0-9]{9}$' THEN '+98' || value
    ELSE NULL END AS phone FROM digits
), candidates AS (
  SELECT id, phone, count(*) OVER (PARTITION BY phone) AS matches FROM normalized WHERE phone IS NOT NULL
)
UPDATE "User" u SET "phoneNumber"=c.phone FROM candidates c WHERE u.id=c.id AND c.matches=1;

CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");
ALTER TABLE "User" ALTER COLUMN "emailNotifications" SET DEFAULT false;
UPDATE "User" SET "emailNotifications"=false;
UPDATE "SystemSetting" SET value=value - 'studentEmailDomains' WHERE key='policy';
DELETE FROM "Session";
DELETE FROM "Reauthentication";
DELETE FROM "Verification";
INSERT INTO "AuditLog" (id,action,metadata) VALUES (gen_random_uuid()::text,'MOBILE_AUTH_MIGRATION','{"legacyContactDataPreserved":true,"previousSessionsRevoked":true,"emailNotificationsDisabled":true}'::jsonb);
