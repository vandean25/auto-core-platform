CREATE UNIQUE INDEX "import_job_rows_tenant_id_import_job_id_apply_seq_key"
  ON "import_job_rows"("tenant_id", "import_job_id", "apply_seq");
