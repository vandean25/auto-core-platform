-- AUT-572: AutoScout24 DMS API push sync status and per-tenant opt-in.

CREATE TYPE "VehicleListingDmsProvider" AS ENUM ('AS24_DMS');

CREATE TYPE "VehicleListingDmsSyncState" AS ENUM (
  'NEVER_SYNCED',
  'PENDING',
  'SYNCED',
  'FAILED',
  'DEACTIVATED'
);

CREATE TABLE "vehicle_listing_push_settings" (
  "tenant_id" TEXT NOT NULL,
  "as24_dms_push_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vehicle_listing_push_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "vehicle_listing_channel_dms_syncs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "provider" "VehicleListingDmsProvider" NOT NULL,
  "external_listing_id" VARCHAR(120),
  "sync_state" "VehicleListingDmsSyncState" NOT NULL DEFAULT 'NEVER_SYNCED',
  "last_sync_at" TIMESTAMP(3),
  "last_sync_error_code" VARCHAR(64),
  "last_idempotency_key" VARCHAR(128),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vehicle_listing_channel_dms_syncs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_listing_channel_dms_syncs_tenant_id_channel_id_provider_key"
  ON "vehicle_listing_channel_dms_syncs"("tenant_id", "channel_id", "provider");
CREATE UNIQUE INDEX "vehicle_listing_channel_dms_syncs_tenant_id_id_key"
  ON "vehicle_listing_channel_dms_syncs"("tenant_id", "id");

ALTER TABLE "vehicle_listing_push_settings"
  ADD CONSTRAINT "vehicle_listing_push_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicle_listing_channel_dms_syncs"
  ADD CONSTRAINT "vehicle_listing_channel_dms_syncs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_listing_channel_dms_syncs"
  ADD CONSTRAINT "vehicle_listing_channel_dms_syncs_tenant_id_channel_id_fkey"
  FOREIGN KEY ("tenant_id", "channel_id") REFERENCES "vehicle_listing_channels"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
