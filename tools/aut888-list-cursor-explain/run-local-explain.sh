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

Captured on a **disposable local PostgreSQL 16** instance in the Cloud Agent VM (\`localhost:5432\`). Database \`${DB_NAME}\` is created by \`tools/aut888-list-cursor-explain/run-local-explain.sh\`, migrated with \`prisma migrate deploy\`, then seeded with **synthetic-only** rows (no QA/prod/customer data).

## Fixture summary

| Table | Rows (tenant \`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\`) |
| --- | ---: |
| \`catalog_items\` | ${ROW_COUNTS} |
| \`vehicles\` (dealer stock filter) | ${VEHICLE_COUNTS} |

Pilot indexes under test: migration \`20261105120000_aut888_list_cursor_keyset_indexes\` (see [list-endpoint-inventory-adr0035](./list-endpoint-inventory-adr0035.md)).

## Method

1. \`run-local-explain.sh\` — drop/create DB, \`prisma migrate deploy\`, \`seed-synthetic.sql\`, \`ANALYZE\`.
2. \`explain-queries.sql\` — SQL shapes aligned with LF 10a pilots (keyset \`ORDER BY sort_col, id\`, capped-count \`LIMIT 1001\` id probe, vehicle filters \`tenant_id\` + \`site_id\` + \`inventory_role IN (USED,NEW,DEMO)\` + \`stock_status = IN_STOCK\`).

## Caveats

- **Not CI**: GitHub e2e Postgres volume is smaller; this evidence is from an intentional synthetic bulk load on a throwaway DB.
- **Single tenant/site**: no concurrent tenants, no search OR filters, no brand/location inventory filters in these plans (baseline selective tenant scope only).
- **VM-local Postgres**: apt-installed PG 16 on Ubuntu 24.04; planner costs differ from Cloud SQL production, but index choice and scan type are what we record honestly below.

## Raw \`EXPLAIN (ANALYZE, BUFFERS)\` output

\`\`\`text
$(sed 's/`/\\`/g' "$CAPTURE")
\`\`\`
EOF

echo "Wrote ${OUT}"
