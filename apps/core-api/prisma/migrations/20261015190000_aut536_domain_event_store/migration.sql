-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "trace_id" UUID NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "payload" JSONB,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_tenant_id_occurrence_key_key" ON "domain_events"("tenant_id", "occurrence_key");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_tenant_id_id_key" ON "domain_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "domain_events_tenant_id_sequence_idx" ON "domain_events"("tenant_id", "sequence");

-- CreateIndex
CREATE INDEX "domain_events_tenant_id_site_id_sequence_idx" ON "domain_events"("tenant_id", "site_id", "sequence");

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
