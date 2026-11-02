-- Data migration: existing sets with status RETURNED that have no events other than INSPECTED become NEW
UPDATE "tyre_sets"
SET "status" = 'NEW'
WHERE "status" = 'RETURNED'
  AND NOT EXISTS (
    SELECT 1
    FROM "tyre_set_events"
    WHERE "tyre_set_events"."tenant_id" = "tyre_sets"."tenant_id"
      AND "tyre_set_events"."tyre_set_id" = "tyre_sets"."id"
      AND "tyre_set_events"."event_type" <> 'INSPECTED'
  );

-- Rollback note:
-- PostgreSQL cannot drop an enum value. Rollback for this data migration:
-- UPDATE "tyre_sets"
-- SET "status" = 'RETURNED'
-- WHERE "status" = 'NEW'
--   AND NOT EXISTS (
--     SELECT 1
--     FROM "tyre_set_events"
--     WHERE "tyre_set_events"."tenant_id" = "tyre_sets"."tenant_id"
--       AND "tyre_set_events"."tyre_set_id" = "tyre_sets"."id"
--       AND "tyre_set_events"."event_type" <> 'INSPECTED'
--   );
-- (The 'NEW' value in enum "TyreSetStatus" remains unused.)

