-- Data migration: existing sets with status RETURNED that have no events at all become NEW
UPDATE "tyre_sets"
SET "status" = 'NEW'
WHERE "status" = 'RETURNED'
  AND NOT EXISTS (
    SELECT 1
    FROM "tyre_set_events"
    WHERE "tyre_set_events"."tyre_set_id" = "tyre_sets"."id"
  );
