-- AUT-551: Vehicle valuation snapshots (disabled Eurotax AT port)

CREATE TABLE "vehicle_valuation_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "site_id" TEXT,
    "national_code" VARCHAR(6) NOT NULL,
    "valuation_type" TEXT NOT NULL,
    "mileage_km" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "requested_as_of" DATE NOT NULL,
    "provider_as_of" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL,
    "reference_version" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "native_id_state" TEXT NOT NULL,
    "input_sha256" CHAR(64) NOT NULL,
    "provider_body_sha256" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_valuation_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_valuation_snapshots_tenant_id_idempotency_key_key" ON "vehicle_valuation_snapshots"("tenant_id", "idempotency_key");

CREATE INDEX "vehicle_valuation_snapshots_tenant_id_vehicle_id_created_at_idx" ON "vehicle_valuation_snapshots"("tenant_id", "vehicle_id", "created_at");

ALTER TABLE "vehicle_valuation_snapshots" ADD CONSTRAINT "vehicle_valuation_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_valuation_snapshots" ADD CONSTRAINT "vehicle_valuation_snapshots_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicle_valuation_snapshots" ADD CONSTRAINT "vehicle_valuation_snapshots_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
