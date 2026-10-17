-- AUT-565: vehicle stock photos (ordering, cover, portal variants metadata)

CREATE TABLE "vehicle_media" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "storage_bucket" TEXT NOT NULL,
    "processed_storage_key" TEXT NOT NULL,
    "variant_storage_keys" JSONB NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_media_tenant_id_id_key" ON "vehicle_media"("tenant_id", "id");

CREATE INDEX "vehicle_media_tenant_id_vehicle_id_sort_order_idx" ON "vehicle_media"("tenant_id", "vehicle_id", "sort_order");

-- Intentional partial unique index (not representable in Prisma schema). Do not drop in drift migrations.
CREATE UNIQUE INDEX "vehicle_media_one_cover_per_vehicle" ON "vehicle_media"("tenant_id", "vehicle_id") WHERE "is_cover" = true;

ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_media" ADD CONSTRAINT "vehicle_media_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
