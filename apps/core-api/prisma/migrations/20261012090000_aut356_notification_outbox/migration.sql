-- AUT-356: transactional notification outbox (ADR-0025 §6). Expand-only: new enums and one new table
-- with its indexes and foreign keys. No existing table, column or enum value is changed.
-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('WORKSHOP_TASK_WAITING_CUSTOMER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationRecipientKind" AS ENUM ('INTERNAL_TEAM', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "NotificationMessageClass" AS ENUM ('TRANSACTIONAL');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'FAILED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient_kind" "NotificationRecipientKind" NOT NULL,
    "recipient_email" TEXT,
    "message_class" "NotificationMessageClass" NOT NULL DEFAULT 'TRANSACTIONAL',
    "workshop_order_id" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "template_id" TEXT,
    "template_version" INTEGER,
    "subject" TEXT,
    "body" TEXT,
    "body_sha256" TEXT,
    "body_purged_at" TIMESTAMP(3),
    "payload" JSONB,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "provider" TEXT,
    "provider_message_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "suppressed_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_outbox_tenant_id_idx" ON "notification_outbox"("tenant_id");

-- CreateIndex
CREATE INDEX "notification_outbox_tenant_id_workshop_order_id_createdAt_idx" ON "notification_outbox"("tenant_id", "workshop_order_id", "createdAt");

-- CreateIndex
CREATE INDEX "notification_outbox_tenant_id_status_next_attempt_at_idx" ON "notification_outbox"("tenant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_tenant_id_idempotency_key_key" ON "notification_outbox"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
