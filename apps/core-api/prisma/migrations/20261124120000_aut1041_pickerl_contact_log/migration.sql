-- CreateEnum
CREATE TYPE "PickerlContactChannel" AS ENUM ('PHONE', 'EMAIL', 'SMS', 'IN_PERSON', 'POST');

-- CreateEnum
CREATE TYPE "PickerlContactOutcome" AS ENUM ('REACHED', 'NO_ANSWER', 'APPOINTMENT_BOOKED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PickerlNoConsentReason" AS ENUM ('CUSTOMER_CALLED', 'ACTIVE_ORDER', 'MARKETING_CALL_WITHOUT_CONSENT');

-- CreateTable
CREATE TABLE "pickerl_contact_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "due_month" VARCHAR(7),
    "contacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "PickerlContactChannel" NOT NULL,
    "outcome" "PickerlContactOutcome",
    "no_consent_reason" "PickerlNoConsentReason",
    "actor_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickerl_contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pickerl_contact_logs_vehicle_due_contacted" ON "pickerl_contact_logs"("tenant_id", "vehicle_id", "due_month", "contacted_at");

-- CreateIndex
CREATE INDEX "idx_pickerl_contact_logs_tenant_customer" ON "pickerl_contact_logs"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "pickerl_contact_logs_tenant_id_id_key" ON "pickerl_contact_logs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenant_id_id_key" ON "tenant_members"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "pickerl_contact_logs" ADD CONSTRAINT "pickerl_contact_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickerl_contact_logs" ADD CONSTRAINT "pickerl_contact_logs_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickerl_contact_logs" ADD CONSTRAINT "pickerl_contact_logs_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickerl_contact_logs" ADD CONSTRAINT "pickerl_contact_logs_tenant_id_actor_member_id_fkey" FOREIGN KEY ("tenant_id", "actor_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
