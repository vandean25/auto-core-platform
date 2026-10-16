-- AUT-591: §57a C2 inspector evidence revisions (append-only)

CREATE TYPE "InspectorEvidenceReviewStatus" AS ENUM ('UNREVIEWED', 'EVIDENCE_REVIEWED', 'SOURCE_CONFLICT');

CREATE TABLE "inspector_evidence_revisions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "schema_version" VARCHAR(32) NOT NULL,
    "source_version" VARCHAR(128) NOT NULL,
    "issuer" VARCHAR(128) NOT NULL,
    "source_person_ref" VARCHAR(128) NOT NULL,
    "station_ref" VARCHAR(128) NOT NULL,
    "assignment_ref" VARCHAR(128) NOT NULL,
    "assignment_from" DATE,
    "assignment_until_exclusive" DATE,
    "vehicle_classes" JSONB NOT NULL,
    "weight_scope" VARCHAR(128),
    "brake_course_scope" VARCHAR(128),
    "training_completed_on" DATE,
    "next_training_due_on" DATE,
    "continuation_from" DATE,
    "continuation_until_exclusive" DATE,
    "effective_from" DATE,
    "effective_until_exclusive" DATE,
    "withdrawal_effective_at" TIMESTAMP(3),
    "document_ref" VARCHAR(128) NOT NULL,
    "document_digest" CHAR(64) NOT NULL,
    "provenance" VARCHAR(128) NOT NULL,
    "evidence_review" "InspectorEvidenceReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewed_at" TIMESTAMP(3),
    "review_valid_until" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "predecessor_revision_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspector_evidence_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspector_evidence_revisions_tenant_id_id_key" ON "inspector_evidence_revisions"("tenant_id", "id");

CREATE INDEX "inspector_evidence_revisions_tenant_id_employee_id_createdAt_idx" ON "inspector_evidence_revisions"("tenant_id", "employee_id", "createdAt");

CREATE INDEX "inspector_evidence_revisions_tenant_id_site_id_station_ref_idx" ON "inspector_evidence_revisions"("tenant_id", "site_id", "station_ref");

ALTER TABLE "inspector_evidence_revisions" ADD CONSTRAINT "inspector_evidence_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspector_evidence_revisions" ADD CONSTRAINT "inspector_evidence_revisions_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspector_evidence_revisions" ADD CONSTRAINT "inspector_evidence_revisions_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspector_evidence_revisions" ADD CONSTRAINT "inspector_evidence_revisions_tenant_id_predecessor_revision_id_fkey" FOREIGN KEY ("tenant_id", "predecessor_revision_id") REFERENCES "inspector_evidence_revisions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
