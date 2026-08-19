-- CreateTable
CREATE TABLE "voice_note_rate_limits" (
    "tenant_id" TEXT NOT NULL,
    "mechanic_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_note_rate_limits_pkey" PRIMARY KEY ("tenant_id","mechanic_id")
);

-- CreateIndex
CREATE INDEX "voice_note_rate_limits_tenant_id_idx" ON "voice_note_rate_limits"("tenant_id");

-- CreateIndex
CREATE INDEX "voice_note_rate_limits_expires_at_idx" ON "voice_note_rate_limits"("expires_at");

-- AddForeignKey
ALTER TABLE "voice_note_rate_limits" ADD CONSTRAINT "voice_note_rate_limits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_note_rate_limits" ADD CONSTRAINT "voice_note_rate_limits_tenant_id_mechanic_id_fkey" FOREIGN KEY ("tenant_id", "mechanic_id") REFERENCES "employees"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
