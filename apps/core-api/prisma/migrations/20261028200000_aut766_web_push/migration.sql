-- AUT-766 / ADR-0033: web push for staff. Expand-only (ADR-0025 section 11): enum values, one nullable column, two new tables.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID', 'DESKTOP');

-- CreateEnum
CREATE TYPE "PushDeviceRevokedReason" AS ENUM ('USER', 'UNREGISTERED', 'STALE', 'MEMBERSHIP_ENDED', 'REPLACED');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'PUSH_TEST';

-- AlterTable
ALTER TABLE "notification_outbox" ADD COLUMN     "recipient_user_id" TEXT;

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "browser" VARCHAR(32),
    "installed" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "PushDeviceRevokedReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled_events" "NotificationEventType"[],
    "quiet_start_min" INTEGER,
    "quiet_end_min" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_devices_tenant_id_user_id_idx" ON "push_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "push_devices_last_seen_at_idx" ON "push_devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_tenant_id_fcm_token_key" ON "push_devices"("tenant_id", "fcm_token");

-- CreateIndex
CREATE INDEX "push_preferences_tenant_id_idx" ON "push_preferences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_preferences_tenant_id_user_id_key" ON "push_preferences"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "notification_outbox_tenant_id_recipient_user_id_createdAt_idx" ON "notification_outbox"("tenant_id", "recipient_user_id", "createdAt");

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_preferences" ADD CONSTRAINT "push_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_preferences" ADD CONSTRAINT "push_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
