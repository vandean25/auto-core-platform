ALTER TABLE "workshop_task_line_items"
ADD COLUMN "deferred_part_reservation" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "idx_workshop_task_line_items_deferred_part_reservation"
ON "workshop_task_line_items" ("tenant_id", "deferred_part_reservation")
WHERE "deferred_part_reservation" = true;
