-- Expand-only: additional pg_trgm GIN indexes for global search S4 (AUT-664)

-- CreateIndex
CREATE INDEX "external_id_mappings_external_id_trgm_idx" ON "external_id_mappings" USING GIN ("external_id" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "labor_operations_code_trgm_idx" ON "labor_operations" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "labor_operations_description_trgm_idx" ON "labor_operations" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "legal_entities_registration_number_trgm_idx" ON "legal_entities" USING GIN ("registration_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "legal_entities_tax_number_trgm_idx" ON "legal_entities" USING GIN ("tax_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_first_name_trgm_idx" ON "users" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_last_name_trgm_idx" ON "users" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vendors_account_number_trgm_idx" ON "vendors" USING GIN ("account_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vendors_email_trgm_idx" ON "vendors" USING GIN ("email" gin_trgm_ops);
