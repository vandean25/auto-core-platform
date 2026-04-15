-- AlterTable
ALTER TABLE "workshop_task_line_items" ADD COLUMN     "actual_hours" DECIMAL(10,2),
ADD COLUMN     "internal_cost_rate" DECIMAL(10,2),
ADD COLUMN     "labor_operation_id" TEXT,
ADD COLUMN     "standard_aw" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "workshop_task_line_items_labor_operation_id_idx" ON "workshop_task_line_items"("labor_operation_id");

-- AddForeignKey
ALTER TABLE "workshop_task_line_items" ADD CONSTRAINT "workshop_task_line_items_labor_operation_id_fkey" FOREIGN KEY ("labor_operation_id") REFERENCES "labor_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

