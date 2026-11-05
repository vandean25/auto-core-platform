#!/usr/bin/env bash
# Disposable local Postgres only. Creates DB aut888_explain_synthetic, migrates, seeds, EXPLAIN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_NAME="${AUT888_EXPLAIN_DB:-aut888_explain_synthetic}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD
export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"
OUT="${ROOT}/docs/internal/04-Database/aut888-list-cursor-explain-evidence.md"
CAPTURE="${ROOT}/tools/aut888-list-cursor-explain/.last-explain-output.txt"

if ! command -v pg_isready >/dev/null && ! command -v pg_ctlcluster >/dev/null; then
  echo "PostgreSQL client tools not found." >&2
  exit 1
fi

if command -v pg_ctlcluster >/dev/null; then
  sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  sudo -u postgres psql -q -c "ALTER USER postgres PASSWORD '${PGPASSWORD}';" >/dev/null 2>&1 || true
fi

if ! pg_isready -h "$PGHOST" -p "$PGPORT" -q; then
  echo "PostgreSQL is not accepting connections on ${PGHOST}:${PGPORT}." >&2
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${DB_NAME}\" WITH (FORCE);"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB_NAME}\";"

echo "Applying Prisma migrations to ${DB_NAME}..."
(
  cd "${ROOT}/apps/core-api"
  npx prisma migrate deploy
)

echo "Seeding synthetic rows..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "${ROOT}/tools/aut888-list-cursor-explain/seed-synthetic.sql"

echo "Running EXPLAIN (ANALYZE, BUFFERS)..."
{
  echo "AUT-888 list cursor EXPLAIN capture"
  echo "Database: ${DB_NAME} on ${PGHOST}:${PGPORT}"
  echo "Captured at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "Fixture: tools/aut888-list-cursor-explain/seed-synthetic.sql"
  echo "---"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "${ROOT}/tools/aut888-list-cursor-explain/explain-queries.sql"
} | tee "$CAPTURE"

ROW_COUNTS="$(psql "$DATABASE_URL" -At -c "SELECT count(*) FROM catalog_items WHERE tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';")"
VEHICLE_COUNTS="$(psql "$DATABASE_URL" -At -c "SELECT count(*) FROM vehicles WHERE tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';")"

cat >"$OUT" <<EOF
---
title: "AUT-888 list cursor EXPLAIN evidence (synthetic)"
date: "$(date -u +"%Y-%m-%d")"
status: draft
tags: [platform, adr-0035, aut-888]
---

# AUT-888 list cursor EXPLAIN evidence (synthetic)

Captured on a **disposable local PostgreSQL 16** instance on a **local VM** (\`localhost:5432\`). Database \`${DB_NAME}\` is created by \`tools/aut888-list-cursor-explain/run-local-explain.sh\`, migrated with \`prisma migrate deploy\`, then seeded with **synthetic-only** rows (no QA/prod/customer data).

## Fixture summary

| Table | Rows (tenant \`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\`) |
| --- | ---: |
| \`catalog_items\` | ${ROW_COUNTS} |
| \`vehicles\` (dealer stock filter) | ${VEHICLE_COUNTS} |

Pilot indexes under test: migration \`20261105120000_aut888_list_cursor_keyset_indexes\` (see [list-endpoint-inventory-adr0035](./list-endpoint-inventory-adr0035.md)).

## Method

1. \`run-local-explain.sh\` — drop/create DB, \`prisma migrate deploy\`, \`seed-synthetic.sql\`, \`ANALYZE\`.
2. \`explain-queries.sql\` — SQL aligned with list services: inventory tenant scope; vehicle **\`vehicles.site_id\`** plus **\`INNER JOIN storage_locations\` on \`location_id\`** with matching \`sl.site_id\` (same as \`buildVehicleListWhere\`), plus dealer-stock role/status filters. Includes first page, continuation, DESC, and capped-count probes.

## Caveats

- **Not CI**: GitHub e2e Postgres volume is smaller; this evidence is from an intentional synthetic bulk load on a throwaway DB.
- **No search/brand/location filters** in these captures (baseline tenant + site scope only).
- **Prisma may differ slightly** in join order or parameter typing; shapes match the list \`where\` clauses (\`vehicles.site_id\` and location join).
- **Mid-list continuation** on composite indexes can show sort/keyset predicates as **Filter** with **Rows Removed by Filter** (index walk from the start — cost grows with page depth). First pages often show cleaner index access on the pilot \`(tenant_id, site_id, sort_col, id)\` indexes.
- **VM-local Postgres**: apt-installed PG 16 on Ubuntu 24.04; planner costs differ from Cloud SQL production.

## Plan summary (honest read)

| Query shape | Notes |
| --- | --- |
| Inventory first page (\`sku\`, \`name\`, \`retail_price\` ASC/DESC) | Usually **Index Scan** / **Index Only Scan** on the matching \`(tenant_id, sort_col, id)\` index with \`tenant_id\` as **Index Cond**. |
| Inventory keyset continuation (\`sku\` tie + \`id\`) | Often **Index Scan** with keyset as **Filter**; read **Rows Removed by Filter** in raw output. |
| Inventory capped-count (\`LIMIT 1001\` ids) | **Seq Scan** + tenant filter at this row count in the capture. |
| Vehicle first page (join + \`make\` / \`plate\` / \`updatedAt\`) | **Index Scan** on \`vehicles_tenant_id_site_id_<sort>_id_idx\` with \`(tenant_id, site_id)\` as **Index Cond**; role/status as **Filter**; nested loop to \`storage_locations\` for join shape. |
| Vehicle keyset continuation (\`make\` tie + \`id\`) | Frequently **Index Scan** on \`vehicles_tenant_id_site_id_make_id_idx\` with large **Filter** / **Rows Removed by Filter** (not constant-time seek). |
| Vehicle capped-count (join shape) | **Seq Scan** or nested loop + filter at this scale in the capture. |

Reproduce: \`tools/aut888-list-cursor-explain/run-local-explain.sh\` (requires local PostgreSQL).

## Raw \`EXPLAIN (ANALYZE, BUFFERS)\` output

\`\`\`text
$(sed 's/`/\\`/g' "$CAPTURE")
\`\`\`
EOF

echo "Wrote ${OUT}"
