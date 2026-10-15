-- CreateEnum
CREATE TYPE "McpWriteCommandReceiptStatus" AS ENUM ('IN_FLIGHT', 'COMPLETED');

-- CreateTable
CREATE TABLE "mcp_write_command_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "command_id" UUID NOT NULL,
    "on_behalf_of_user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "site_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "args_fingerprint" TEXT NOT NULL,
    "status" "McpWriteCommandReceiptStatus" NOT NULL DEFAULT 'IN_FLIGHT',
    "original_trace_id" UUID NOT NULL,
    "response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_write_command_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_write_command_receipts_tenant_id_command_id_key" ON "mcp_write_command_receipts"("tenant_id", "command_id");

-- CreateIndex
CREATE INDEX "mcp_write_command_receipts_tenant_id_on_behalf_of_user_id_idx" ON "mcp_write_command_receipts"("tenant_id", "on_behalf_of_user_id");

-- CreateIndex
CREATE INDEX "mcp_write_command_receipts_tenant_id_original_trace_id_idx" ON "mcp_write_command_receipts"("tenant_id", "original_trace_id");

-- AddForeignKey
ALTER TABLE "mcp_write_command_receipts" ADD CONSTRAINT "mcp_write_command_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
