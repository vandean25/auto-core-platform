-- CreateEnum
CREATE TYPE "WorkshopPartLineExecutionStatus" AS ENUM (
  'PENDING_PICK',
  'STAGED',
  'CONSUMED',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "InspectionTemplateItemResponseType" AS ENUM (
  'PASS_FAIL',
  'NUMERIC',
  'TEXT'
);

-- CreateEnum
CREATE TYPE "WorkshopInspectionSeverity" AS ENUM (
  'OK',
  'ADVISORY',
  'REQUIRED'
);

-- CreateEnum
CREATE TYPE "WorkshopMediaUrlStrategy" AS ENUM (
  'SIGNED',
  'PUBLIC'
);

-- AlterTable
ALTER TABLE "workshop_task_line_items"
  ADD COLUMN "part_execution_status" "WorkshopPartLineExecutionStatus";

UPDATE "workshop_task_line_items"
SET "part_execution_status" = 'PENDING_PICK'
WHERE "type" = 'PART' AND "part_execution_status" IS NULL;

ALTER TABLE "workshop_task_line_items"
  ADD CONSTRAINT "workshop_task_line_items_part_status_check"
  CHECK (
    (
      "type" = 'PART'
      AND "part_execution_status" IS NOT NULL
    )
    OR (
      "type" = 'LABOR'
      AND "part_execution_status" IS NULL
    )
  );

CREATE INDEX "idx_workshop_task_line_items_part_status"
  ON "workshop_task_line_items"("tenant_id", "type", "part_execution_status");

-- CreateTable
CREATE TABLE "inspection_templates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_template_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "inspection_template_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "response_type" "InspectionTemplateItemResponseType" NOT NULL,
  "unit" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inspection_template_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workshop_inspections" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "workshop_order_id" TEXT NOT NULL,
  "workshop_task_id" TEXT,
  "inspection_template_id" TEXT,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workshop_inspections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workshop_inspection_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "workshop_inspection_id" TEXT NOT NULL,
  "inspection_template_item_id" TEXT,
  "label_snapshot" TEXT NOT NULL,
  "response_value" TEXT,
  "unit" TEXT,
  "passed" BOOLEAN,
  "severity" "WorkshopInspectionSeverity",
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workshop_inspection_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workshop_media" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "workshop_order_id" TEXT NOT NULL,
  "workshop_task_id" TEXT,
  "uploaded_by_employee_id" TEXT NOT NULL,
  "storage_bucket" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "url_strategy" "WorkshopMediaUrlStrategy" NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "duration_seconds" DECIMAL(10, 2),
  "caption" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workshop_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_templates_tenant_id_idx" ON "inspection_templates"("tenant_id");
CREATE UNIQUE INDEX "inspection_templates_tenant_id_id_key" ON "inspection_templates"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_templates_tenant_id_code_version_key" ON "inspection_templates"("tenant_id", "code", "version");

CREATE INDEX "inspection_template_items_tenant_id_idx" ON "inspection_template_items"("tenant_id");
CREATE UNIQUE INDEX "inspection_template_items_tenant_id_id_key" ON "inspection_template_items"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_template_items_tenant_id_inspection_template_id_code_key" ON "inspection_template_items"("tenant_id", "inspection_template_id", "code");
CREATE INDEX "idx_inspection_template_items_template" ON "inspection_template_items"("tenant_id", "inspection_template_id");

CREATE INDEX "workshop_inspections_tenant_id_idx" ON "workshop_inspections"("tenant_id");
CREATE UNIQUE INDEX "workshop_inspections_tenant_id_id_key" ON "workshop_inspections"("tenant_id", "id");
CREATE INDEX "idx_workshop_inspections_order" ON "workshop_inspections"("tenant_id", "workshop_order_id");
CREATE INDEX "idx_workshop_inspections_task" ON "workshop_inspections"("tenant_id", "workshop_task_id");
CREATE INDEX "idx_workshop_inspections_template" ON "workshop_inspections"("tenant_id", "inspection_template_id");

CREATE INDEX "workshop_inspection_items_tenant_id_idx" ON "workshop_inspection_items"("tenant_id");
CREATE UNIQUE INDEX "workshop_inspection_items_tenant_id_id_key" ON "workshop_inspection_items"("tenant_id", "id");
CREATE INDEX "idx_workshop_inspection_items_inspection" ON "workshop_inspection_items"("tenant_id", "workshop_inspection_id");
CREATE INDEX "idx_workshop_inspection_items_template_item" ON "workshop_inspection_items"("tenant_id", "inspection_template_item_id");

CREATE INDEX "workshop_media_tenant_id_idx" ON "workshop_media"("tenant_id");
CREATE UNIQUE INDEX "workshop_media_tenant_id_id_key" ON "workshop_media"("tenant_id", "id");
CREATE INDEX "idx_workshop_media_order" ON "workshop_media"("tenant_id", "workshop_order_id");
CREATE INDEX "idx_workshop_media_task" ON "workshop_media"("tenant_id", "workshop_task_id");
CREATE INDEX "idx_workshop_media_employee" ON "workshop_media"("tenant_id", "uploaded_by_employee_id");

-- AddForeignKey
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_template_items" ADD CONSTRAINT "inspection_template_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_template_items" ADD CONSTRAINT "inspection_template_items_tenant_id_inspection_template_id_fkey"
  FOREIGN KEY ("tenant_id", "inspection_template_id") REFERENCES "inspection_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_inspections" ADD CONSTRAINT "workshop_inspections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_inspections" ADD CONSTRAINT "workshop_inspections_tenant_id_workshop_order_id_fkey"
  FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workshop_inspections" ADD CONSTRAINT "workshop_inspections_workshop_task_id_fkey"
  FOREIGN KEY ("workshop_task_id") REFERENCES "workshop_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workshop_inspections" ADD CONSTRAINT "workshop_inspections_tenant_id_inspection_template_id_fkey"
  FOREIGN KEY ("tenant_id", "inspection_template_id") REFERENCES "inspection_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_inspection_items" ADD CONSTRAINT "workshop_inspection_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_inspection_items" ADD CONSTRAINT "workshop_inspection_items_tenant_id_workshop_inspection_id_fkey"
  FOREIGN KEY ("tenant_id", "workshop_inspection_id") REFERENCES "workshop_inspections"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workshop_inspection_items" ADD CONSTRAINT "workshop_inspection_items_tenant_id_inspection_template_item_id_fkey"
  FOREIGN KEY ("tenant_id", "inspection_template_item_id") REFERENCES "inspection_template_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_media" ADD CONSTRAINT "workshop_media_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_media" ADD CONSTRAINT "workshop_media_tenant_id_workshop_order_id_fkey"
  FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workshop_media" ADD CONSTRAINT "workshop_media_workshop_task_id_fkey"
  FOREIGN KEY ("workshop_task_id") REFERENCES "workshop_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workshop_media" ADD CONSTRAINT "workshop_media_tenant_id_uploaded_by_employee_id_fkey"
  FOREIGN KEY ("tenant_id", "uploaded_by_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;