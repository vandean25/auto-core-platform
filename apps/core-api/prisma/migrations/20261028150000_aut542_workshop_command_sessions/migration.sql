-- AUT-542: local workshop command interpreter replay and idempotency.
ALTER TABLE "agent_proposals" ADD COLUMN "command_id" UUID;

CREATE UNIQUE INDEX "agent_proposals_tenant_id_command_id_key"
  ON "agent_proposals" ("tenant_id", "command_id");

CREATE TABLE "workshop_command_sessions" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "command_id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "normalized_json" JSONB NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workshop_command_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workshop_command_sessions_tenant_id_command_id_key"
  ON "workshop_command_sessions" ("tenant_id", "command_id");

CREATE INDEX "workshop_command_sessions_tenant_id_expires_at_idx"
  ON "workshop_command_sessions" ("tenant_id", "expires_at");

ALTER TABLE "workshop_command_sessions"
  ADD CONSTRAINT "workshop_command_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
