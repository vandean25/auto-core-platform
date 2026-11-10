-- Link workshop-originated invoice lines to stable workshop task line ids (checkout VAT/discount mapping).
ALTER TABLE "invoice_items" ADD COLUMN "workshop_task_line_item_id" TEXT;

CREATE INDEX "invoice_items_workshop_task_line_item_id_idx" ON "invoice_items"("workshop_task_line_item_id");

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_workshop_task_line_item_id_fkey" FOREIGN KEY ("workshop_task_line_item_id") REFERENCES "workshop_task_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
