-- AUT-1040: Customer notes (pinnable, audited CustomerNote with GDPR access/erasure/retention rules) and ACCOUNTING role.

ALTER TYPE "TenantMemberRole" ADD VALUE IF NOT EXISTS 'ACCOUNTING';

CREATE TYPE "CustomerNoteRetentionClass" AS ENUM ('OPERATIONAL', 'CLAIMS_3Y');

CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "body" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "author_member_id" TEXT,
    "author_role" "TenantMemberRole",
    "retention_class" "CustomerNoteRetentionClass" NOT NULL DEFAULT 'OPERATIONAL',
    "retain_until" TIMESTAMP(3) NOT NULL,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "erasure_restricted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_notes_tenant_id_id_key" ON "customer_notes"("tenant_id", "id");

CREATE INDEX "idx_customer_notes_tenant_customer_active" ON "customer_notes"("tenant_id", "customer_id", "deleted_at", "pinned", "created_at");

CREATE INDEX "idx_customer_notes_retention" ON "customer_notes"("tenant_id", "retain_until", "legal_hold", "deleted_at");

ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_author_member_id_fkey"
  FOREIGN KEY ("tenant_id", "author_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
