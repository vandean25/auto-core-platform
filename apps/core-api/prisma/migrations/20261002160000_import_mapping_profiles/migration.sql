-- CreateTable
CREATE TABLE "import_mapping_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" "ImportEntityType" NOT NULL,
    "source_system" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping_json" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mapping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_profiles_tenant_id_id_key" ON "import_mapping_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_profiles_tenant_id_entity_type_source_system__key" ON "import_mapping_profiles"("tenant_id", "entity_type", "source_system", "name");

-- CreateIndex
CREATE INDEX "import_mapping_profiles_tenant_id_entity_type_source_system_idx" ON "import_mapping_profiles"("tenant_id", "entity_type", "source_system");

-- AddForeignKey
ALTER TABLE "import_mapping_profiles" ADD CONSTRAINT "import_mapping_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
