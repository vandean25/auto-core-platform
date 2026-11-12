CREATE TABLE "purchase_order_sequences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_sequences_tenant_id_year_key" ON "purchase_order_sequences"("tenant_id", "year");
CREATE INDEX "purchase_order_sequences_tenant_id_idx" ON "purchase_order_sequences"("tenant_id");

ALTER TABLE "purchase_order_sequences" ADD CONSTRAINT "purchase_order_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
