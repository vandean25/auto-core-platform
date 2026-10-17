ALTER TABLE "workshop_check_ins"
  ADD COLUMN "inspection_id" TEXT;

CREATE UNIQUE INDEX "workshop_check_ins_tenant_id_inspection_id_key"
  ON "workshop_check_ins"("tenant_id", "inspection_id");

CREATE INDEX "idx_workshop_check_ins_inspection"
  ON "workshop_check_ins"("tenant_id", "inspection_id");

ALTER TABLE "workshop_check_ins"
  ADD CONSTRAINT "workshop_check_ins_tenant_id_inspection_id_fkey"
  FOREIGN KEY ("tenant_id", "inspection_id")
  REFERENCES "workshop_inspections"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
