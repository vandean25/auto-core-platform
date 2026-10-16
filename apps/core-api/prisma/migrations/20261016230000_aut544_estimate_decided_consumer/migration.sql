-- AUT-544: durable consumer cursor/delivery for workshop_estimate.decided.v1 internal notices.

CREATE TABLE "domain_event_consumer_progress" (
    "tenant_id" TEXT NOT NULL,
    "consumer_key" TEXT NOT NULL,
    "cursor_sequence" BIGINT NOT NULL DEFAULT 0,
    "cursor_event_id" TEXT,
    "claim_token" UUID,
    "claim_expires_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_event_consumer_progress_pkey" PRIMARY KEY ("tenant_id","consumer_key")
);

CREATE TABLE "domain_event_consumer_deliveries" (
    "tenant_id" TEXT NOT NULL,
    "consumer_key" TEXT NOT NULL,
    "domain_event_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notification_outbox_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "domain_event_consumer_deliveries_tenant_consumer_event_key" ON "domain_event_consumer_deliveries"("tenant_id", "consumer_key", "domain_event_id");

CREATE INDEX "domain_event_consumer_deliveries_tenant_consumer_idx" ON "domain_event_consumer_deliveries"("tenant_id", "consumer_key");

ALTER TABLE "domain_event_consumer_progress" ADD CONSTRAINT "domain_event_consumer_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "domain_event_consumer_deliveries" ADD CONSTRAINT "domain_event_consumer_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "domain_event_consumer_deliveries" ADD CONSTRAINT "domain_event_consumer_deliveries_domain_event_fkey" FOREIGN KEY ("tenant_id", "domain_event_id") REFERENCES "domain_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
