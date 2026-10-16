-- AUT-576: expand-only locale preferences and snapshot freeze metadata.

CREATE TYPE "DisplayLanguage" AS ENUM ('de', 'en');

ALTER TABLE "users"
ADD COLUMN "locale" "DisplayLanguage";

ALTER TABLE "tenants"
ADD COLUMN "default_locale" "DisplayLanguage" NOT NULL DEFAULT 'de',
ADD COLUMN "format_locale" VARCHAR(8) NOT NULL DEFAULT 'de-AT';

ALTER TABLE "customers"
ADD COLUMN "preferred_language" "DisplayLanguage";

ALTER TABLE "workshop_orders"
ADD COLUMN "pdf_render_input" JSONB;

ALTER TABLE "tenants"
ADD CONSTRAINT "tenants_format_locale_de_at_chk" CHECK ("format_locale" = 'de-AT');

ALTER TABLE "notification_outbox"
ADD COLUMN "document_locale" "DisplayLanguage",
ADD COLUMN "format_locale" VARCHAR(8);
