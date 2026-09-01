#!/usr/bin/env bash
# ============================================================================
# AUT-252 migration backfill verification
#
# Verifies the expand → backfill → validate → contract migration against a
# pre-seeded "legacy" database:
#   * tenant WITHOUT WorkshopSettings           -> AT fallback, defaults, 7 rows
#   * tenant WITH CH holiday country            -> LegalEntity AT, Site CH
#   * tenant WITH partial opening-hour rows     -> 7 rows after fill
#   * tenant with an INACTIVE TenantMember      -> SiteMembership copied is_active
#   * tenant with a parked dealer vehicle with null location -> assigned MAIN LOT
#   * a persisted ON_ORDER dealer vehicle       -> migration FAILS (asserted)
#
# Usage:
#   DATABASE_URL=postgresql://... ./scripts/verify-multi-location-migration.sh
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP="$ROOT/apps/core-api"
MIGRATIONS="$APP/prisma/migrations"
STASH_DIR="$(mktemp -d)"

NEW_MIGRATIONS=(
  "20260831180000_add_in_transit_location_type"
  "20260901000000_multi_location_legal_entity_site"
)

DB_URL="${DATABASE_URL:?DATABASE_URL is required (must be a dedicated scratch DB)}"
PSQL_URL="${DB_URL%%\?*}"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
psql_cmd() {
  # DATABASE_URL is postgresql://user:pass@host:port/db
  psql "$PSQL_URL" -v ON_ERROR_STOP=1 -qAt ${1:+-c "$1"}
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

step() {
  echo "==> $1"
}

# ---------------------------------------------------------------------------
# 0. cleanup any previous run
# ---------------------------------------------------------------------------
step "Resetting scratch DB"
psql_cmd "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

# ---------------------------------------------------------------------------
# 1. apply all migrations EXCEPT the two new ones
# ---------------------------------------------------------------------------
step "Stashing new migrations"
STASHED=()
for name in "${NEW_MIGRATIONS[@]}"; do
  if [ -d "$MIGRATIONS/$name" ]; then
    mv "$MIGRATIONS/$name" "$STASH_DIR/"
    STASHED+=("$name")
  fi
done

step "Applying pre-existing migrations"
(
  cd "$APP"
  npx prisma migrate deploy
) >/dev/null

step "Restoring new migrations"
for name in "${STASHED[@]}"; do
  mv "$STASH_DIR/$name" "$MIGRATIONS/"
done

# ---------------------------------------------------------------------------
# 2. seed legacy fixtures
# ---------------------------------------------------------------------------
step "Seeding legacy fixtures"
psql_cmd <<'SQL' >/dev/null
-- Tenant A: NO WorkshopSettings row
INSERT INTO tenants (id, name, slug, plan, created_at, updated_at, is_active)
VALUES ('t-a', 'Tenant A', 'tenant-a', 'STANDARD', NOW(), NOW(), true);

INSERT INTO users (id, firebase_uid, email, active_tenant_id, "createdAt", "updatedAt")
VALUES ('u-a', 'fb-a', 'a@example.com', 't-a', NOW(), NOW());
INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active, "createdAt", "updatedAt")
VALUES ('tm-a', 't-a', 'u-a', 'OWNER', true, NOW(), NOW());

-- Tenant B: CH holiday country + partial opening hours + inactive member
INSERT INTO tenants (id, name, slug, plan, created_at, updated_at, is_active)
VALUES ('t-b', 'Tenant B', 'tenant-b', 'STANDARD', NOW(), NOW(), true);

INSERT INTO users (id, firebase_uid, email, active_tenant_id, "createdAt", "updatedAt")
VALUES ('u-b', 'fb-b', 'b@example.com', 't-b', NOW(), NOW()),
       ('u-b2', 'fb-b2', 'b2@example.com', 't-b', NOW(), NOW());
INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active, "createdAt", "updatedAt")
VALUES ('tm-b', 't-b', 'u-b', 'OWNER', true, NOW(), NOW()),
       ('tm-b2', 't-b', 'u-b2', 'ADMIN', false, NOW(), NOW());

INSERT INTO workshop_settings (id, tenant_id, timezone, slot_minutes, holiday_country_iso, "createdAt", "updatedAt")
VALUES ('ws-b', 't-b', 'Europe/Berlin', 60, 'CH', NOW(), NOW());

INSERT INTO workshop_opening_hours (id, tenant_id, workshop_settings_id, weekday, is_closed, open_time, close_time)
VALUES
  ('oh-b1', 't-b', 'ws-b', 1, false, '08:00', '17:00'),
  ('oh-b2', 't-b', 'ws-b', 2, false, '08:00', '17:00'),
  ('oh-b3', 't-b', 'ws-b', 3, false, '08:00', '17:00'),
  ('oh-b4', 't-b', 'ws-b', 4, false, '08:00', '17:00'),
  ('oh-b5', 't-b', 'ws-b', 5, false, '08:00', '17:00');

INSERT INTO workshop_holidays (id, tenant_id, workshop_settings_id, name, observed_on, repeats_annually, is_closed)
VALUES ('hol-b', 't-b', 'ws-b', 'Züri-Fäscht', '2026-07-02', false, true);

INSERT INTO bays (id, tenant_id, name, is_active, sort_order, "createdAt", "updatedAt")
VALUES ('bay-b', 't-b', 'Bay 1', true, 0, NOW(), NOW());

-- Tenant C: US holiday country, existing vehicle_lot, parked vehicle WITHOUT location
INSERT INTO tenants (id, name, slug, plan, created_at, updated_at, is_active)
VALUES ('t-c', 'Tenant C', 'tenant-c', 'STANDARD', NOW(), NOW(), true);

INSERT INTO workshop_settings (id, tenant_id, timezone, slot_minutes, holiday_country_iso, "createdAt", "updatedAt")
VALUES ('ws-c', 't-c', 'America/New_York', 30, 'US', NOW(), NOW());

INSERT INTO vehicles (id, tenant_id, make, model, year, inventory_role, stock_status, "createdAt", "updatedAt")
VALUES ('v-c1', 't-c', 'Ford', 'Mustang', 2020, 'USED', 'IN_STOCK', NOW(), NOW()),
       ('v-c2', 't-c', 'Dodge', 'Charger', 2021, 'NEW', 'RESERVED', NOW(), NOW());
SQL

# ---------------------------------------------------------------------------
# 3. apply the new migration and assert
# ---------------------------------------------------------------------------
step "Applying multi-location migration"
(
  cd "$APP"
  npx prisma migrate deploy
) >/dev/null

step "Asserting backfill results"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM legal_entities WHERE tenant_id = 't-a' AND country_iso = 'AT' AND is_active = true;")
[ "$COUNT" = "1" ] || fail "Tenant A: expected 1 active AT legal entity, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM sites WHERE tenant_id = 't-a' AND code = 'MAIN' AND timezone = 'Europe/Vienna' AND slot_minutes = 30 AND holiday_country_iso = 'AT';")
[ "$COUNT" = "1" ] || fail "Tenant A: expected MAIN site with defaults, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM workshop_opening_hours WHERE tenant_id = 't-a';")
[ "$COUNT" = "7" ] || fail "Tenant A: expected 7 opening hours, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM site_memberships WHERE tenant_id = 't-a' AND is_active = true;")
[ "$COUNT" = "1" ] || fail "Tenant A: expected 1 active site membership, got $COUNT"

# Tenant B: CH fallback on legal entity, CH preserved on site
COUNT=$(psql_cmd "SELECT COUNT(*) FROM legal_entities WHERE tenant_id = 't-b' AND country_iso = 'AT';")
[ "$COUNT" = "1" ] || fail "Tenant B: expected LegalEntity country_iso=AT (CH fallback), got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM sites WHERE tenant_id = 't-b' AND holiday_country_iso = 'CH' AND timezone = 'Europe/Berlin' AND slot_minutes = 60;")
[ "$COUNT" = "1" ] || fail "Tenant B: expected Site to preserve CH + Berlin/60, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM workshop_opening_hours WHERE tenant_id = 't-b';")
[ "$COUNT" = "7" ] || fail "Tenant B: expected 7 opening hours after fill, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM workshop_holidays WHERE tenant_id = 't-b';")
[ "$COUNT" = "1" ] || fail "Tenant B: expected holiday migrated, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM site_memberships sm JOIN tenant_members tm ON sm.tenant_id = tm.tenant_id AND sm.user_id = tm.user_id WHERE sm.tenant_id = 't-b' AND tm.is_active = false AND sm.is_active = false;")
[ "$COUNT" = "1" ] || fail "Tenant B: expected inactive membership copied as inactive, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM bays WHERE tenant_id = 't-b' AND site_id IS NOT NULL;")
[ "$COUNT" = "1" ] || fail "Tenant B: expected bay stamped with site_id, got $COUNT"

# Tenant C: US fallback + parked vehicles remediated to MAIN LOT
COUNT=$(psql_cmd "SELECT COUNT(*) FROM legal_entities WHERE tenant_id = 't-c' AND country_iso = 'AT';")
[ "$COUNT" = "1" ] || fail "Tenant C: expected LegalEntity country_iso=AT (US fallback), got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM sites WHERE tenant_id = 't-c' AND holiday_country_iso = 'US';")
[ "$COUNT" = "1" ] || fail "Tenant C: expected Site to preserve US holiday country, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM storage_locations WHERE tenant_id = 't-c' AND type = 'in_transit' AND is_system = true;")
[ "$COUNT" = "1" ] || fail "Tenant C: expected one system in_transit location, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM vehicles v JOIN storage_locations l ON v.location_id = l.id WHERE v.tenant_id = 't-c' AND l.type = 'vehicle_lot' AND v.stock_status IN ('IN_STOCK','RESERVED','IN_PREP');")
[ "$COUNT" = "2" ] || fail "Tenant C: expected both parked vehicles on a vehicle_lot, got $COUNT"

COUNT=$(psql_cmd "SELECT COUNT(*) FROM storage_locations WHERE tenant_id = 't-c' AND code = 'LOT' AND type = 'vehicle_lot';")
[ "$COUNT" = "1" ] || fail "Tenant C: expected default LOT created, got $COUNT"

# ---------------------------------------------------------------------------
# 4. validate phase: persisted ON_ORDER vehicle must FAIL the migration
# ---------------------------------------------------------------------------
step "Asserting ON_ORDER persisted vehicle fails the migration"
psql_cmd "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
for name in "${NEW_MIGRATIONS[@]}"; do
  mv "$MIGRATIONS/$name" "$STASH_DIR/"
done
(
  cd "$APP"
  npx prisma migrate deploy
) >/dev/null

psql_cmd <<'SQL' >/dev/null
INSERT INTO tenants (id, name, slug, plan, created_at, updated_at, is_active)
VALUES ('t-onorder', 'ON Order Tenant', 'onorder', 'STANDARD', NOW(), NOW(), true);
INSERT INTO vehicles (id, tenant_id, make, model, year, inventory_role, stock_status, "createdAt", "updatedAt")
VALUES ('v-onorder', 't-onorder', 'Tesla', 'Model 3', 2023, 'USED', 'ON_ORDER', NOW(), NOW());
SQL

for name in "${NEW_MIGRATIONS[@]}"; do
  mv "$STASH_DIR/$name" "$MIGRATIONS/"
done

if (
  cd "$APP"
  npx prisma migrate deploy
) >/dev/null 2>&1; then
  fail "Migration unexpectedly succeeded with a persisted ON_ORDER vehicle"
fi
echo "OK: migration rejected persisted ON_ORDER vehicle as required"

# ---------------------------------------------------------------------------
# 4b. failure-path verification: schema/data must be unchanged and rerunnable
# ---------------------------------------------------------------------------
step "Asserting failed migration left the schema/data unchanged"
# The ON_ORDER preflight runs before ANY mutation, so no new types/tables may
# exist yet (Prisma also rolls back the whole transaction on failure).
TBL=$(psql_cmd "SELECT to_regclass('public.legal_entities');")
[ "$TBL" = "NULL" ] || [ -z "$TBL" ] || fail "Expected legal_entities to NOT exist after failed preflight, got: $TBL"

TBL=$(psql_cmd "SELECT to_regclass('public.sites');")
[ "$TBL" = "NULL" ] || [ -z "$TBL" ] || fail "Expected sites to NOT exist after failed preflight, got: $TBL"

# The legacy seed row must still be intact (no partial backfill).
COUNT=$(psql_cmd "SELECT COUNT(*) FROM tenants WHERE id = 't-onorder';")
[ "$COUNT" = "1" ] || fail "Legacy tenant row disappeared after failed migration"

# Rerunnable: applying the migration after removing the bad row succeeds.
# The failed attempt is recorded in _prisma_migrations; because the preflight
# ran before ANY mutation, resolving it as rolled back is safe (nothing was
# applied), then a fresh deploy re-runs the whole expand→backfill→contract.
step "Asserting the migration is rerunnable after fixing the data"
psql_cmd "DELETE FROM vehicles WHERE id = 'v-onorder';" >/dev/null
(
  cd "$APP"
  npx prisma migrate resolve --rolled-back 20260901000000_multi_location_legal_entity_site >/dev/null 2>&1 || true
)
if ! (
  cd "$APP"
  npx prisma migrate deploy
) >/dev/null 2>&1; then
  fail "Migration was not rerunnable after the preflight blocker was removed"
fi
COUNT=$(psql_cmd "SELECT COUNT(*) FROM legal_entities WHERE tenant_id = 't-onorder';")
[ "$COUNT" = "1" ] || fail "Rerun did not backfill a legal entity for tenant t-onorder"
COUNT=$(psql_cmd "SELECT COUNT(*) FROM sites WHERE tenant_id = 't-onorder' AND code = 'MAIN';")
[ "$COUNT" = "1" ] || fail "Rerun did not backfill a MAIN site for tenant t-onorder"

# ---------------------------------------------------------------------------
# 5. cleanup
# ---------------------------------------------------------------------------
psql_cmd "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

echo ""
echo "ALL AUT-252 MIGRATION BACKFILL CHECKS PASSED"
