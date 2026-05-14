-- AlterTable
ALTER TABLE "employees"
ADD COLUMN "mother_language_code" TEXT;

-- CreateEnum
CREATE TYPE "WorkshopVoiceNoteDraftStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateTable
CREATE TABLE "voice_translation_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_language_code" TEXT NOT NULL DEFAULT 'de',
    "google_project_id" TEXT,
    "google_location" TEXT NOT NULL DEFAULT 'global',
    "google_service_account_encrypted" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "voice_translation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_voice_note_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_task_id" TEXT NOT NULL,
    "mechanic_employee_id" TEXT NOT NULL,
    "status" "WorkshopVoiceNoteDraftStatus" NOT NULL DEFAULT 'PENDING',
    "source_language_code" TEXT,
    "target_language_code" TEXT NOT NULL,
    "original_text" TEXT NOT NULL,
    "translated_text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "duration_seconds" DECIMAL(10,2),
    "accepted_at" TIMESTAMP(3),
    "accepted_by_employee_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workshop_voice_note_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_translation_settings_tenant_id_key" ON "voice_translation_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "voice_translation_settings_tenant_id_idx" ON "voice_translation_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_workshop_voice_note_drafts_task" ON "workshop_voice_note_drafts"("tenant_id", "workshop_task_id");

-- CreateIndex
CREATE INDEX "idx_workshop_voice_note_drafts_mechanic" ON "workshop_voice_note_drafts"("tenant_id", "mechanic_employee_id");

-- AddForeignKey
ALTER TABLE "voice_translation_settings" ADD CONSTRAINT "voice_translation_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_voice_note_drafts" ADD CONSTRAINT "workshop_voice_note_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_voice_note_drafts" ADD CONSTRAINT "workshop_voice_note_drafts_tenant_id_workshop_task_id_fkey" FOREIGN KEY ("tenant_id", "workshop_task_id") REFERENCES "workshop_tasks"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_voice_note_drafts" ADD CONSTRAINT "workshop_voice_note_drafts_tenant_id_mechanic_employee_id_fkey" FOREIGN KEY ("tenant_id", "mechanic_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_voice_note_drafts" ADD CONSTRAINT "workshop_voice_note_drafts_tenant_id_accepted_by_employee_id_fkey" FOREIGN KEY ("tenant_id", "accepted_by_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
