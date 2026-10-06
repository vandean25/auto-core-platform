-- CreateTable
CREATE TABLE "decision_shadow_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trace_id" UUID NOT NULL,
    "use_case" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "input_redacted_json" JSONB NOT NULL,
    "suggestion_json" JSONB,
    "actual_outcome_json" JSONB NOT NULL,
    "match" BOOLEAN,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "latency_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_shadow_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_shadow_logs_tenant_id_id_key" ON "decision_shadow_logs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "decision_shadow_logs_tenant_id_created_at_idx" ON "decision_shadow_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "decision_shadow_logs_tenant_id_trace_id_created_at_idx" ON "decision_shadow_logs"("tenant_id", "trace_id", "created_at");

-- CreateIndex
CREATE INDEX "decision_shadow_logs_tenant_id_use_case_created_at_idx" ON "decision_shadow_logs"("tenant_id", "use_case", "created_at");

-- AddForeignKey
ALTER TABLE "decision_shadow_logs" ADD CONSTRAINT "decision_shadow_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
