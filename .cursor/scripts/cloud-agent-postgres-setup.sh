#!/usr/bin/env bash
set -euo pipefail

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acp_cloud') THEN
    CREATE ROLE acp_cloud LOGIN PASSWORD 'acp_cloud_local_only';
  ELSE
    ALTER ROLE acp_cloud WITH LOGIN PASSWORD 'acp_cloud_local_only';
  END IF;
END
$$;

ALTER ROLE postgres WITH LOGIN PASSWORD 'postgres';
SQL

if ! sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = 'core_platform'" | grep -q 1; then
  sudo -u postgres createdb -O acp_cloud core_platform
fi

if ! sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = 'auto_core_test'" | grep -q 1; then
  sudo -u postgres createdb -O postgres auto_core_test
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE core_platform TO acp_cloud;"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET synchronous_commit = 'off';
SQL
