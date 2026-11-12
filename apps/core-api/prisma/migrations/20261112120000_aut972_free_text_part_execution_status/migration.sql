-- Free-text PART lines (no catalog_item_id) do not use the pick workflow.
ALTER TABLE "workshop_task_line_items"
  DROP CONSTRAINT IF EXISTS "workshop_task_line_items_part_status_check";

ALTER TABLE "workshop_task_line_items"
  ADD CONSTRAINT "workshop_task_line_items_part_status_check"
  CHECK (
    (
      "type" IN ('LABOR', 'FEE')
      AND "part_execution_status" IS NULL
    )
    OR (
      "type" = 'PART'
      AND "catalog_item_id" IS NOT NULL
      AND "part_execution_status" IS NOT NULL
    )
    OR (
      "type" = 'PART'
      AND "catalog_item_id" IS NULL
      AND "part_execution_status" IS NULL
    )
  );

UPDATE "workshop_task_line_items"
SET "part_execution_status" = NULL
WHERE "type" = 'PART'
  AND "catalog_item_id" IS NULL
  AND "part_execution_status" IS NOT NULL;
