-- AUT-567: vehicle listing, per-portal channels, and photo selection

CREATE TYPE "VehicleListingDescriptionLanguage" AS ENUM ('DE', 'EN');
CREATE TYPE "VehicleListingVatDisplay" AS ENUM ('STANDARD', 'MARGIN');
CREATE TYPE "VehicleListingPlatform" AS ENUM ('MOBILE_DE', 'AS24', 'WILLHABEN');
CREATE TYPE "VehicleListingDesiredState" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "VehicleListingExportState" AS ENUM ('NEVER_EXPORTED', 'DIRTY', 'FILE_GENERATED', 'REMOVAL_REQUIRED', 'REMOVAL_ACKNOWLEDGED');
CREATE TYPE "VehicleListingRemoteState" AS ENUM ('UNKNOWN', 'MANUALLY_REPORTED_INACTIVE', 'CONFIRMED_ACTIVE', 'CONFIRMED_INACTIVE');

CREATE TABLE "vehicle_listings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "stock_purchase_id" TEXT NOT NULL,
    "listing_ref" VARCHAR(33) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(120),
    "description" VARCHAR(3000),
    "description_language" "VehicleListingDescriptionLanguage" NOT NULL DEFAULT 'DE',
    "price_gross_eur" DECIMAL(12,2),
    "vat_display" "VehicleListingVatDisplay",
    "nova_included_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_fees_included_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "equipment_free_text" VARCHAR(2000),
    "content_sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_listings_tenant_id_vehicle_id_stock_purchase_id_key" ON "vehicle_listings"("tenant_id", "vehicle_id", "stock_purchase_id");
CREATE UNIQUE INDEX "vehicle_listings_tenant_id_listing_ref_key" ON "vehicle_listings"("tenant_id", "listing_ref");
CREATE UNIQUE INDEX "vehicle_listings_tenant_id_id_key" ON "vehicle_listings"("tenant_id", "id");
CREATE INDEX "vehicle_listings_tenant_id_site_id_idx" ON "vehicle_listings"("tenant_id", "site_id");

CREATE TABLE "vehicle_listing_channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "platform" "VehicleListingPlatform" NOT NULL,
    "serializer_profile" VARCHAR(64) NOT NULL,
    "mapping_version" VARCHAR(16) NOT NULL,
    "desired_state" "VehicleListingDesiredState" NOT NULL DEFAULT 'INACTIVE',
    "export_state" "VehicleListingExportState" NOT NULL DEFAULT 'NEVER_EXPORTED',
    "remote_state" "VehicleListingRemoteState" NOT NULL DEFAULT 'UNKNOWN',
    "last_export_at" TIMESTAMPTZ(3),
    "last_export_content_sha256" CHAR(64),
    "external_ref" VARCHAR(120),
    "removal_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_listing_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_listing_channels_tenant_id_listing_id_platform_key" ON "vehicle_listing_channels"("tenant_id", "listing_id", "platform");
CREATE UNIQUE INDEX "vehicle_listing_channels_tenant_id_id_key" ON "vehicle_listing_channels"("tenant_id", "id");
CREATE INDEX "vehicle_listing_channels_tenant_id_platform_export_state_idx" ON "vehicle_listing_channels"("tenant_id", "platform", "export_state");

CREATE TABLE "vehicle_listing_photos" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_listing_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_listing_photos_tenant_id_listing_id_media_id_key" ON "vehicle_listing_photos"("tenant_id", "listing_id", "media_id");
CREATE UNIQUE INDEX "vehicle_listing_photos_tenant_id_id_key" ON "vehicle_listing_photos"("tenant_id", "id");
CREATE INDEX "vehicle_listing_photos_tenant_id_listing_id_sort_order_idx" ON "vehicle_listing_photos"("tenant_id", "listing_id", "sort_order");

ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_tenant_id_stock_purchase_id_fkey" FOREIGN KEY ("tenant_id", "stock_purchase_id") REFERENCES "vehicle_purchases"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicle_listing_channels" ADD CONSTRAINT "vehicle_listing_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_listing_channels" ADD CONSTRAINT "vehicle_listing_channels_tenant_id_listing_id_fkey" FOREIGN KEY ("tenant_id", "listing_id") REFERENCES "vehicle_listings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicle_listing_photos" ADD CONSTRAINT "vehicle_listing_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_listing_photos" ADD CONSTRAINT "vehicle_listing_photos_tenant_id_listing_id_fkey" FOREIGN KEY ("tenant_id", "listing_id") REFERENCES "vehicle_listings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_listing_photos" ADD CONSTRAINT "vehicle_listing_photos_tenant_id_media_id_fkey" FOREIGN KEY ("tenant_id", "media_id") REFERENCES "vehicle_media"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
