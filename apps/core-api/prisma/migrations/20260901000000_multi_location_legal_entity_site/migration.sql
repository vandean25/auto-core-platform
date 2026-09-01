-- ============================================================================
-- AUT-252: Multi-Location — LegalEntity, Site, SiteMembership and safe backfill
-- Source: docs/internal/02-Feature-Specs/Platform/2026-08-31-multi-location-sites-and-legal-entities.md
-- Source: docs/internal/01-ADR/2026-08-31-site-operational-scope.md (ADR-0022)
--
-- Strategy: expand → backfill → validate → contract.
-- All site-owned columns are added nullable in EXPAND; backfill populates them;
-- VALIDATE asserts zero missing rows; CONTRACT sets NOT NULL, adds composite FKs,
-- drops tenant-singleton WorkshopSettings, and locks down deletion invariants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXPAND — new enums, tables, and nullable columns
-- ----------------------------------------------------------------------------

CREATE TYPE "LegalEntityCountry" AS ENUM ('AT', 'DE');

-- Note: 'in_transit' was added to LocationType in migration
-- 20260831180000_add_in_transit_location_type so it could be referenced here.

CREATE TABLE "legal_entities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_iso" "LegalEntityCountry" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_street" TEXT,
    "address_city" TEXT,
    "address_zip" TEXT,
    "address_country" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Vienna',
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "holiday_country_iso" TEXT NOT NULL DEFAULT 'AT',
    "holiday_subdivision_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_memberships_pkey" PRIMARY KEY ("id")
);

-- User.active_site_id — nullable, composite FK after contract
ALTER TABLE "users" ADD COLUMN "active_site_id" TEXT;

-- StorageLocation + Bay become site-scoped. Columns added nullable; backfill
-- writes site_id; contract sets NOT NULL and adds composite FKs.
ALTER TABLE "bays" ADD COLUMN "site_id" TEXT;
ALTER TABLE "storage_locations" ADD COLUMN "site_id" TEXT;
ALTER TABLE "storage_locations" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

-- WorkshopSettings is going away (ruling 56). Its data moves to the MAIN Site
-- during backfill. We drop it in the contract phase below.

-- WorkshopOpeningHour / WorkshopHoliday gain site_id and drop the tenant-only
-- uniqueness so Wien and München can share a date.
ALTER TABLE "workshop_opening_hours" ADD COLUMN "site_id" TEXT;
ALTER TABLE "workshop_holidays" ADD COLUMN "site_id" TEXT;

-- Make workshop_settings_id nullable so the backfill can insert rows without a
-- tenant-level WorkshopSettings before we drop it in the contract phase.
ALTER TABLE "workshop_opening_hours" ALTER COLUMN "workshop_settings_id" DROP NOT NULL;
ALTER TABLE "workshop_holidays" ALTER COLUMN "workshop_settings_id" DROP NOT NULL;

-- Deferrable: drop the tenant-only unique on observed_on; replace it after backfill
ALTER TABLE "workshop_holidays" DROP CONSTRAINT IF EXISTS "workshop_holidays_tenant_id_observed_on_key";

-- Indexes to support composite FKs and the spec's read patterns
CREATE INDEX "legal_entities_tenant_id_idx" ON "legal_entities"("tenant_id");
CREATE UNIQUE INDEX "legal_entities_tenant_id_id_key" ON "legal_entities"("tenant_id", "id");
CREATE UNIQUE INDEX "legal_entities_tenant_id_name_key" ON "legal_entities"("tenant_id", "name");

CREATE INDEX "sites_tenant_id_idx" ON "sites"("tenant_id");
CREATE UNIQUE INDEX "sites_tenant_id_id_key" ON "sites"("tenant_id", "id");
CREATE UNIQUE INDEX "sites_tenant_id_code_key" ON "sites"("tenant_id", "code");

CREATE INDEX "site_memberships_tenant_id_idx" ON "site_memberships"("tenant_id");
CREATE INDEX "site_memberships_tenant_id_user_id_idx" ON "site_memberships"("tenant_id", "user_id");
CREATE INDEX "site_memberships_tenant_id_site_id_idx" ON "site_memberships"("tenant_id", "site_id");
CREATE UNIQUE INDEX "site_memberships_tenant_id_user_id_site_id_key" ON "site_memberships"("tenant_id", "user_id", "site_id");

CREATE INDEX "bays_tenant_id_site_id_idx" ON "bays"("tenant_id", "site_id");
CREATE INDEX "storage_locations_tenant_id_site_id_idx" ON "storage_locations"("tenant_id", "site_id");
CREATE UNIQUE INDEX "storage_locations_tenant_id_site_id_id_key" ON "storage_locations"("tenant_id", "site_id", "id");
CREATE UNIQUE INDEX "storage_locations_tenant_id_site_id_code_key" ON "storage_locations"("tenant_id", "site_id", "code");

CREATE INDEX "workshop_opening_hours_tenant_id_site_id_idx" ON "workshop_opening_hours"("tenant_id", "site_id");
CREATE INDEX "workshop_holidays_tenant_id_site_id_idx" ON "workshop_holidays"("tenant_id", "site_id");

-- ----------------------------------------------------------------------------
-- BACKFILL
-- ----------------------------------------------------------------------------
-- For each existing tenant:
--   * 1 LegalEntity  (country from WorkshopSettings when AT/DE; else AT fallback)
--   * 1 Site        (code=MAIN, hours from WorkshopSettings, defaults otherwise)
--   * 1 system in_transit location per site
--   * 1 default vehicle_lot (code=LOT) if the tenant has no vehicle_lot
--   * SiteMembership for every TenantMember (is_active copied)
--   * User.active_site_id for users with an active TenantMember in this tenant
--   * opening hours: 7 rows copied/filled with DEFAULT_OPENING_HOURS
--   * WorkshopHoliday site_id stamped from settings row
--   * Existing bay / storage_location site_id stamped from settings row
--   * Parked dealer vehicles remediated onto MAIN LOT
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  tenant_rec RECORD;
  v_le_id TEXT;
  v_site_id TEXT;
  v_in_transit_loc_id TEXT;
  v_default_lot_id TEXT;
  ws_id TEXT;
  ws_country_iso TEXT;
  ws_timezone TEXT;
  ws_slot INTEGER;
  ws_subdiv TEXT;
  ws_holiday_country TEXT;
  v_active_member_count INT;
  v_hours_count INT;
  dow INT;
BEGIN
  FOR tenant_rec IN SELECT id, name FROM tenants LOOP
    -- ------------------------------------------------------------------
    -- 1. Find or default the tenant's existing WorkshopSettings
    -- ------------------------------------------------------------------
    SELECT id, timezone, slot_minutes, holiday_country_iso, holiday_subdivision_code
      INTO ws_id, ws_timezone, ws_slot, ws_holiday_country, ws_subdiv
      FROM workshop_settings
     WHERE tenant_id = tenant_rec.id
     LIMIT 1;

    IF ws_id IS NULL THEN
      ws_country_iso := 'AT';
      ws_timezone := 'Europe/Vienna';
      ws_slot := 30;
      ws_subdiv := NULL;
      ws_holiday_country := 'AT';
    ELSE
      ws_country_iso := ws_holiday_country;
      IF ws_country_iso NOT IN ('AT','DE') THEN
        -- Spec ruling 3/39: LegalEntity.country_iso falls back to AT.
        -- Preserve the original code on Site.holiday_country_iso.
        ws_country_iso := 'AT';
      END IF;
    END IF;

    -- ------------------------------------------------------------------
    -- 2. LegalEntity
    -- ------------------------------------------------------------------
    INSERT INTO legal_entities (id, tenant_id, name, country_iso, is_active, "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::text,
      tenant_rec.id,
      tenant_rec.name,
      ws_country_iso::"LegalEntityCountry",
      true,
      NOW(), NOW()
    )
    RETURNING id INTO v_le_id;

    -- ------------------------------------------------------------------
    -- 3. MAIN Site
    -- ------------------------------------------------------------------
    INSERT INTO sites (
      id, tenant_id, legal_entity_id, code, name,
      timezone, slot_minutes, holiday_country_iso, holiday_subdivision_code,
      is_active, "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text,
      tenant_rec.id, v_le_id, 'MAIN', tenant_rec.name,
      COALESCE(ws_timezone, 'Europe/Vienna'),
      COALESCE(ws_slot, 30),
      COALESCE(NULLIF(ws_holiday_country, ''), 'AT'),
      ws_subdiv,
      true, NOW(), NOW()
    )
    RETURNING id INTO v_site_id;

    -- ------------------------------------------------------------------
    -- 4. System in_transit location (one per site; ruling 34)
    -- ------------------------------------------------------------------
    INSERT INTO storage_locations (
      id, tenant_id, site_id, code, name, type, is_system,
      parent_id, "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text,
      tenant_rec.id, v_site_id, 'TRANSIT', 'In Transit', 'in_transit', true,
      NULL, NOW(), NOW()
    )
    RETURNING id INTO v_in_transit_loc_id;

    -- ------------------------------------------------------------------
    -- 5. Default LOT (vehicle_lot) if the tenant has none
    -- ------------------------------------------------------------------
    SELECT id INTO v_default_lot_id
      FROM storage_locations
     WHERE tenant_id = tenant_rec.id AND type = 'vehicle_lot' AND "deletedAt" IS NULL
     LIMIT 1;

    IF v_default_lot_id IS NULL THEN
      INSERT INTO storage_locations (
        id, tenant_id, site_id, code, name, type, is_system,
        parent_id, "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        tenant_rec.id, v_site_id, 'LOT', 'Vehicle Lot', 'vehicle_lot', false,
        NULL, NOW(), NOW()
      )
      RETURNING id INTO v_default_lot_id;
    END IF;

    -- ------------------------------------------------------------------
    -- 6. Stamp existing bays, storage locations, opening hours, holidays
    --    with site_id = MAIN site.
    -- ------------------------------------------------------------------
    UPDATE bays SET site_id = v_site_id WHERE tenant_id = tenant_rec.id AND site_id IS NULL;
    UPDATE storage_locations SET site_id = v_site_id WHERE tenant_id = tenant_rec.id AND site_id IS NULL;
    UPDATE workshop_opening_hours SET site_id = v_site_id WHERE tenant_id = tenant_rec.id AND site_id IS NULL;
    UPDATE workshop_holidays SET site_id = v_site_id WHERE tenant_id = tenant_rec.id AND site_id IS NULL;

    -- ------------------------------------------------------------------
    -- 7. Opening hours: ensure each site has exactly 7 weekday rows
    --    (DEFAULT_OPENING_HOURS from apps/core-api/src/workshop/workshop-hours.defaults.ts)
    -- ------------------------------------------------------------------

    -- Map tenant-level workshop_settings_id rows to the new site_id
    IF ws_id IS NOT NULL THEN
      UPDATE workshop_opening_hours
         SET site_id = v_site_id
       WHERE tenant_id = tenant_rec.id AND workshop_settings_id = ws_id AND site_id IS NULL;

      UPDATE workshop_holidays
         SET site_id = v_site_id
       WHERE tenant_id = tenant_rec.id AND workshop_settings_id = ws_id AND site_id IS NULL;
    END IF;

    -- Fill any missing weekday (ISO 1..7) with DEFAULT_OPENING_HOURS
    FOR dow IN 1..7 LOOP
      SELECT COUNT(*) INTO v_hours_count
        FROM workshop_opening_hours
       WHERE tenant_id = tenant_rec.id AND site_id = v_site_id AND weekday = dow;

      IF v_hours_count = 0 THEN
        INSERT INTO workshop_opening_hours (id, tenant_id, site_id, weekday, is_closed, open_time, close_time)
        VALUES (
          gen_random_uuid()::text,
          tenant_rec.id, v_site_id, dow,
          CASE WHEN dow = 7 THEN true ELSE false END,
          CASE WHEN dow = 6 THEN '08:00' ELSE '07:30' END,
          CASE WHEN dow = 6 THEN '12:00' ELSE '17:00' END
        );
      END IF;
    END LOOP;

    -- The original unique constraint (tenant_id, weekday) on workshop_opening_hours
    -- and (tenant_id, observed_on) on workshop_holidays prevented duplicates at the
    -- tenant level. The expand phase dropped the observed_on uniqueness; the
    -- contract phase recreates per-site uniqueness. No deduplication needed here.

    -- ------------------------------------------------------------------
    -- 8. SiteMembership for every TenantMember, is_active copied
    -- ------------------------------------------------------------------
    INSERT INTO site_memberships (id, tenant_id, user_id, site_id, is_active, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text,
           tm.tenant_id,
           tm.user_id,
           v_site_id,
           tm.is_active,
           NOW(), NOW()
      FROM tenant_members tm
     WHERE tm.tenant_id = tenant_rec.id
       AND NOT EXISTS (
         SELECT 1 FROM site_memberships sm
          WHERE sm.tenant_id = tm.tenant_id
            AND sm.user_id = tm.user_id
            AND sm.site_id = v_site_id
       );

    -- ------------------------------------------------------------------
    -- 9. User.active_site_id for users whose active_tenant_id is this tenant
    --    AND who have an active TenantMember here.
    -- ------------------------------------------------------------------
    UPDATE users u
       SET active_site_id = v_site_id
     WHERE u.active_tenant_id = tenant_rec.id
       AND u.active_site_id IS NULL
       AND EXISTS (
         SELECT 1 FROM tenant_members tm
          WHERE tm.tenant_id = tenant_rec.id
            AND tm.user_id = u.id
            AND tm.is_active = true
       );

    -- ------------------------------------------------------------------
    -- 10. Existing dealer vehicles remediation (ruling 40)
    --     * assert zero ON_ORDER rows
    --     * assign MAIN LOT to non-SOLD dealer vehicles missing/non-lot location
    -- ------------------------------------------------------------------
    PERFORM 1 FROM vehicles
       WHERE tenant_id = tenant_rec.id
         AND inventory_role IN ('USED','NEW','DEMO')
         AND stock_status = 'ON_ORDER';
    IF FOUND THEN
      RAISE EXCEPTION
        'Backfill failed for tenant %: persisted Vehicle rows with stock_status=ON_ORDER exist. Migrate draft purchases to ON_ORDER-list projection first.', tenant_rec.id;
    END IF;

    UPDATE vehicles v
       SET location_id = v_default_lot_id
     WHERE v.tenant_id = tenant_rec.id
       AND v.inventory_role IN ('USED','NEW','DEMO')
       AND v.stock_status IN ('IN_STOCK','RESERVED','IN_PREP')
       AND (
         v.location_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM storage_locations sl
            WHERE sl.id = v.location_id
              AND sl.type = 'vehicle_lot'
         )
       );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- VALIDATE
-- ----------------------------------------------------------------------------
-- Every site-owned column must be 100% populated before contract sets NOT NULL.

DO $$
DECLARE
  bad_count INT;
BEGIN
  -- No persisted ON_ORDER dealer vehicles (ruling 46).
  SELECT COUNT(*) INTO bad_count FROM vehicles
   WHERE inventory_role IN ('USED','NEW','DEMO') AND stock_status = 'ON_ORDER';
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Validation failed: % persisted ON_ORDER dealer Vehicle rows.', bad_count;
  END IF;

  -- Every non-SOLD dealer vehicle must have a vehicle_lot location.
  SELECT COUNT(*) INTO bad_count FROM vehicles v
   WHERE v.inventory_role IN ('USED','NEW','DEMO')
     AND v.stock_status IN ('IN_STOCK','RESERVED','IN_PREP')
     AND (
       v.location_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM storage_locations sl
          WHERE sl.id = v.location_id AND sl.type = 'vehicle_lot'
       )
     );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Validation failed: % parked dealer vehicles without a vehicle_lot.', bad_count;
  END IF;

  -- Every bay / storage_location / workshop_opening_hour / workshop_holiday must
  -- have a site_id equal to a real site of the same tenant.
  SELECT COUNT(*) INTO bad_count FROM bays b
    WHERE b.site_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM sites s
          WHERE s.tenant_id = b.tenant_id AND s.id = b.site_id
       );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Validation failed: % bays without a valid site_id.', bad_count;
  END IF;

  SELECT COUNT(*) INTO bad_count FROM storage_locations sl
    WHERE sl.site_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM sites s
          WHERE s.tenant_id = sl.tenant_id AND s.id = sl.site_id
       );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Validation failed: % storage_locations without a valid site_id.', bad_count;
  END IF;

  -- User.active_site_id (when set) must belong to the user's active_tenant_id.
  SELECT COUNT(*) INTO bad_count FROM users u
    WHERE u.active_site_id IS NOT NULL
      AND (
        u.active_tenant_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM sites s
           WHERE s.tenant_id = u.active_tenant_id AND s.id = u.active_site_id
        )
      );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Validation failed: % users with active_site_id referencing another tenant.', bad_count;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- CONTRACT — set NOT NULL, add composite FKs, drop legacy WorkshopSettings
-- ----------------------------------------------------------------------------

-- NOT NULL
ALTER TABLE "bays" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "storage_locations" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "workshop_opening_hours" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "workshop_holidays" ALTER COLUMN "site_id" SET NOT NULL;

-- Composite FKs
-- NOTE: Prisma generates FKs with `ON UPDATE CASCADE ON DELETE <action>`.
-- Match that exactly so `prisma migrate diff` does not report drift.
ALTER TABLE "legal_entities"
    ADD CONSTRAINT "legal_entities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "sites"
    ADD CONSTRAINT "sites_tenant_id_fkey"
    FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "sites"
    ADD CONSTRAINT "sites_tenant_id_legal_entity_id_fkey"
    FOREIGN KEY ("tenant_id", "legal_entity_id")
    REFERENCES "legal_entities" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "site_memberships"
    ADD CONSTRAINT "site_memberships_tenant_id_fkey"
    FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "site_memberships"
    ADD CONSTRAINT "site_memberships_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "users" ("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "site_memberships"
    ADD CONSTRAINT "site_memberships_tenant_id_site_id_fkey"
    FOREIGN KEY ("tenant_id", "site_id")
    REFERENCES "sites" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "site_memberships"
    ADD CONSTRAINT "site_memberships_tenant_id_user_id_fkey"
    FOREIGN KEY ("tenant_id", "user_id")
    REFERENCES "tenant_members" ("tenant_id", "user_id")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "bays"
    ADD CONSTRAINT "bays_tenant_id_site_id_fkey"
    FOREIGN KEY ("tenant_id", "site_id")
    REFERENCES "sites" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "storage_locations"
    ADD CONSTRAINT "storage_locations_tenant_id_site_id_fkey"
    FOREIGN KEY ("tenant_id", "site_id")
    REFERENCES "sites" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- Old single-column parent FK replaced by the site-safe composite FK below.
ALTER TABLE "storage_locations"
    DROP CONSTRAINT IF EXISTS "storage_locations_parent_id_fkey";

ALTER TABLE "storage_locations"
    ADD CONSTRAINT "storage_locations_tenant_id_site_id_parent_id_fkey"
    FOREIGN KEY ("tenant_id", "site_id", "parent_id")
    REFERENCES "storage_locations" ("tenant_id", "site_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "workshop_opening_hours"
    ADD CONSTRAINT "workshop_opening_hours_tenant_id_site_id_fkey"
    FOREIGN KEY ("tenant_id", "site_id")
    REFERENCES "sites" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "workshop_holidays"
    ADD CONSTRAINT "workshop_holidays_tenant_id_site_id_fkey"
    FOREIGN KEY ("tenant_id", "site_id")
    REFERENCES "sites" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- Replace the old tenant-level uniques/indexes with the site-scoped ones
-- (Wien and München can share a date; ruling 246-247).
DROP INDEX IF EXISTS "bays_tenant_id_name_key";
CREATE UNIQUE INDEX "bays_tenant_id_site_id_name_key"
    ON "bays" ("tenant_id", "site_id", "name");
DROP INDEX IF EXISTS "storage_locations_tenant_id_code_key";
CREATE UNIQUE INDEX "storage_locations_tenant_id_id_key"
    ON "storage_locations" ("tenant_id", "id");
DROP INDEX IF EXISTS "workshop_opening_hours_tenant_id_weekday_key";
DROP INDEX IF EXISTS "workshop_opening_hours_tenant_id_site_id_idx";
DROP INDEX IF EXISTS "workshop_holidays_tenant_id_observed_on_key";
DROP INDEX IF EXISTS "workshop_holidays_tenant_id_site_id_idx";

-- Unique indexes that were dropped in expand (after backfill data is final)
CREATE UNIQUE INDEX "workshop_opening_hours_tenant_id_site_id_weekday_key"
    ON "workshop_opening_hours" ("tenant_id", "site_id", "weekday");
CREATE UNIQUE INDEX "workshop_holidays_tenant_id_site_id_observed_on_key"
    ON "workshop_holidays" ("tenant_id", "site_id", "observed_on");

-- User.active_site_id composite FK to sites (ruling 11/44).
-- Deliberately unmodeled in schema.prisma: active_tenant_id is already bound
-- to the Tenant relation, so Prisma cannot express this composite. Kept as a
-- DB-only constraint; `prisma migrate deploy` applies it, `migrate dev` would
-- want to drop it (use deploy, as CI does).
ALTER TABLE "users"
    ADD CONSTRAINT "users_active_tenant_id_active_site_id_fkey"
    FOREIGN KEY ("active_tenant_id", "active_site_id")
    REFERENCES "sites" ("tenant_id", "id")
    ON UPDATE CASCADE ON DELETE SET NULL;

-- Drop tenant-singleton WorkshopSettings. Its data lives on Site now.
-- WorkshopOpeningHour.workshop_settings_id and WorkshopHoliday.workshop_settings_id
-- are not referenced by any current code path (WorkshopSettingsService had the
-- only readers and is rewritten to delegate to Site).
ALTER TABLE "workshop_opening_hours" DROP COLUMN IF EXISTS "workshop_settings_id";
ALTER TABLE "workshop_holidays" DROP COLUMN IF EXISTS "workshop_settings_id";
DROP TABLE IF EXISTS "workshop_settings";

-- System locations (in_transit and the MAIN LOT) cannot be disabled or deleted
-- while they hold non-SOLD dealer vehicles (ruling 45). The service layer
-- enforces direct-delete protection on is_system=true; FK changes here make
-- the contract binding at the DB level.
ALTER TABLE "vehicles"
    DROP CONSTRAINT IF EXISTS "vehicles_location_id_fkey";
ALTER TABLE "vehicles"
    ADD CONSTRAINT "vehicles_location_id_fkey"
    FOREIGN KEY ("location_id")
    REFERENCES "storage_locations" ("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;