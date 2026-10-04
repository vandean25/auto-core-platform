-- CreateEnum
CREATE TYPE "AgentProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_proposals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trace_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "preview_json" JSONB,
    "tier" "AgentPolicyTier" NOT NULL DEFAULT 'PROPOSE',
    "status" "AgentProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (now() + '7 days'::interval),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_proposals_tenant_id_id_key" ON "agent_proposals"("tenant_id", "id");
CREATE INDEX "agent_proposals_tenant_id_status_created_at_idx" ON "agent_proposals"("tenant_id", "status", "created_at");
CREATE INDEX "agent_proposals_tenant_id_trace_id_idx" ON "agent_proposals"("tenant_id", "trace_id");

-- AddForeignKey
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
