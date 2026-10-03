-- CreateEnum
CREATE TYPE "AgentActionLogActorType" AS ENUM ('AGENT', 'USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "agent_action_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trace_id" UUID NOT NULL,
    "parent_trace_id" UUID,
    "actor_type" "AgentActionLogActorType" NOT NULL,
    "agent_id" TEXT,
    "on_behalf_of_user_id" TEXT,
    "action_type" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input_summary_json" JSONB,
    "result_summary_json" JSONB,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "reverted_by_log_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_action_logs_tenant_id_id_key" ON "agent_action_logs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_created_at_idx" ON "agent_action_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_trace_id_created_at_idx" ON "agent_action_logs"("tenant_id", "trace_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_agent_id_created_at_idx" ON "agent_action_logs"("tenant_id", "agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_status_created_at_idx" ON "agent_action_logs"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_tier_created_at_idx" ON "agent_action_logs"("tenant_id", "tier", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_entity_type_entity_id_created_at_idx" ON "agent_action_logs"("tenant_id", "entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_tenant_id_reverted_by_log_id_fkey" FOREIGN KEY ("tenant_id", "reverted_by_log_id") REFERENCES "agent_action_logs"("tenant_id", "id") ON DELETE SET NULL ("reverted_by_log_id") ON UPDATE CASCADE;
