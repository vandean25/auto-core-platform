-- AUT-560: simple e-signature evidence columns on workshop check-in (expand-only)

ALTER TABLE "workshop_check_ins"
ADD COLUMN "signed_by_name" VARCHAR(200),
ADD COLUMN "signed_at" TIMESTAMP(3),
ADD COLUMN "acknowledgement_version" VARCHAR(64),
ADD COLUMN "acknowledgement_text" TEXT,
ADD COLUMN "device_hash" CHAR(64),
ADD COLUMN "ip_hash" CHAR(64);

-- One signature media row per check-in (acyclic with workshop_media.check_in_id FK).
CREATE UNIQUE INDEX "workshop_media_one_signature_per_check_in"
ON "workshop_media"("tenant_id", "check_in_id")
WHERE "purpose" = 'CHECK_IN_SIGNATURE' AND "check_in_id" IS NOT NULL;
