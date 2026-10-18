-- AUT-562: partial index for unattached check-in media orphan purge candidates

CREATE INDEX "idx_workshop_media_check_in_orphan_candidates"
ON "workshop_media"("tenant_id", "createdAt")
WHERE "check_in_id" IS NULL AND "purpose" IN ('CHECK_IN', 'CHECK_IN_SIGNATURE');
