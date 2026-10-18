-- AUT-572: store payload digest for push idempotency.

ALTER TABLE "vehicle_listing_channel_dms_syncs"
  ADD COLUMN "last_sync_payload_digest" CHAR(64);
