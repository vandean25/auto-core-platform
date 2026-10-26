ALTER TABLE "import_job_rows" ADD COLUMN "apply_seq" INTEGER;

CREATE INDEX "import_job_rows_tenant_id_import_job_id_apply_seq_idx"
  ON "import_job_rows"("tenant_id", "import_job_id", "apply_seq");
