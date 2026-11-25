-- Add writing transaction xid8 so readers can filter out events at or above pg_snapshot_xmin(pg_current_snapshot()) (AUT-1052).
ALTER TABLE "domain_events"
  ADD COLUMN "tx_xid" xid8 NOT NULL DEFAULT pg_current_xact_id();

CREATE VIEW "visible_domain_events" AS
SELECT
  "id",
  "sequence",
  "event_type",
  "schema_version",
  "tenant_id",
  "site_id",
  "entity_id",
  "occurred_at",
  "trace_id",
  "occurrence_key",
  "payload"
FROM "domain_events"
WHERE "tx_xid" < pg_snapshot_xmin(pg_current_snapshot());
