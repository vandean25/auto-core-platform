-- AUT-560: simple e-signature evidence columns on workshop check-in (expand-only)

ALTER TABLE "workshop_check_ins"
ADD COLUMN "signed_by_name" VARCHAR(200),
ADD COLUMN "signed_at" TIMESTAMP(3),
ADD COLUMN "signature_media_id" TEXT,
ADD COLUMN "acknowledgement_version" VARCHAR(64),
ADD COLUMN "acknowledgement_text" TEXT,
ADD COLUMN "device_hash" CHAR(64),
ADD COLUMN "ip_hash" CHAR(64);

ALTER TABLE "workshop_check_ins"
ADD CONSTRAINT "workshop_check_ins_tenant_id_signature_media_id_fkey"
FOREIGN KEY ("tenant_id", "signature_media_id") REFERENCES "workshop_media"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "workshop_check_ins_tenant_id_signature_media_id_key"
ON "workshop_check_ins"("tenant_id", "signature_media_id");
