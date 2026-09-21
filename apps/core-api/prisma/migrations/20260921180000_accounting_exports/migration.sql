-- CreateTable
CREATE TABLE "accounting_exports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "profile_snapshot" JSONB NOT NULL,
    "document_manifest" JSONB NOT NULL,
    "site_ids" JSONB NOT NULL,
    "file_bytes" BYTEA NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL,
    "document_count" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_exports_tenant_id_legal_entity_id_createdAt_idx" ON "accounting_exports"("tenant_id", "legal_entity_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_exports_tenant_id_id_key" ON "accounting_exports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_exports_tenant_id_idempotency_key_key" ON "accounting_exports"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
