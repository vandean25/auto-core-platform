-- AUT-938: expand-only migration for saved_views and saved_view_imports.

CREATE TYPE "SavedViewVisibility" AS ENUM ('PERSONAL', 'TENANT');

CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "list_path" VARCHAR(128) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "href" VARCHAR(2000) NOT NULL,
    "visibility" "SavedViewVisibility" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_view_imports" (
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_view_imports_pkey" PRIMARY KEY ("tenant_id", "user_id")
);

CREATE INDEX "saved_views_tenant_id_owner_user_id_idx"
  ON "saved_views" ("tenant_id", "owner_user_id");

CREATE INDEX "saved_views_tenant_id_visibility_idx"
  ON "saved_views" ("tenant_id", "visibility");

CREATE INDEX "saved_views_tenant_id_list_path_idx"
  ON "saved_views" ("tenant_id", "list_path");

CREATE UNIQUE INDEX "saved_views_personal_unique_name_idx"
  ON "saved_views" ("tenant_id", "owner_user_id", "list_path", lower("name"))
  WHERE "visibility" = 'PERSONAL';

CREATE UNIQUE INDEX "saved_views_tenant_unique_name_idx"
  ON "saved_views" ("tenant_id", "list_path", lower("name"))
  WHERE "visibility" = 'TENANT';

CREATE INDEX "saved_view_imports_user_id_idx"
  ON "saved_view_imports" ("user_id");

ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "saved_view_imports"
  ADD CONSTRAINT "saved_view_imports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_view_imports"
  ADD CONSTRAINT "saved_view_imports_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
