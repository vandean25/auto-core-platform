-- Add writing transaction xid8 so readers can filter out events at or above pg_snapshot_xmin(pg_current_snapshot()) (AUT-1052).
ALTER TABLE "domain_events"
  ADD COLUMN "tx_xid" xid8 NOT NULL DEFAULT pg_current_xact_id();
