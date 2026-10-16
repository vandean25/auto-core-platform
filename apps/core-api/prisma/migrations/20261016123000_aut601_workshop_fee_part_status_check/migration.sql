-- Allow FEE lines without part execution status (same as LABOR).
ALTER TABLE "workshop_task_line_items"
  DROP CONSTRAINT IF EXISTS "workshop_task_line_items_part_status_check";

ALTER TABLE "workshop_task_line_items"
  ADD CONSTRAINT "workshop_task_line_items_part_status_check"
  CHECK (
    (
      "type" = 'PART'
      AND "part_execution_status" IS NOT NULL
    )
    OR (
      "type" IN ('LABOR', 'FEE')
      AND "part_execution_status" IS NULL
    )
  );
