-- AUT-547: Self-service landing demo access (expand-only).

ALTER TYPE "TenantMemberRole" ADD VALUE 'DEMO';

ALTER TYPE "NotificationEventType" ADD VALUE 'LANDING_DEMO_MAGIC_LINK';
ALTER TYPE "NotificationEventType" ADD VALUE 'LANDING_DEMO_OPERATOR_ALERT';

ALTER TABLE "tenants" ADD COLUMN "is_landing_demo_tenant" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tenant_members" ADD COLUMN "demo_access_expires_at" TIMESTAMPTZ;

CREATE TABLE "landing_demo_access_requests" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "betrieb" VARCHAR(200) NOT NULL,
    "telefon" VARCHAR(80),
    "nachricht" VARCHAR(2000),
    "consent_recorded_at" TIMESTAMPTZ NOT NULL,
    "client_ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_demo_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "landing_demo_access_requests_email_created_at_idx"
    ON "landing_demo_access_requests"("email", "created_at" DESC);

CREATE TABLE "landing_demo_sign_in_grants" (
    "id" UUID NOT NULL,
    "access_request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "invalidated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_demo_sign_in_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "landing_demo_sign_in_grants_user_id_created_at_idx"
    ON "landing_demo_sign_in_grants"("user_id", "created_at" DESC);

CREATE INDEX "landing_demo_sign_in_grants_expires_at_idx"
    ON "landing_demo_sign_in_grants"("expires_at");

ALTER TABLE "landing_demo_sign_in_grants" ADD CONSTRAINT "landing_demo_sign_in_grants_access_request_id_fkey"
    FOREIGN KEY ("access_request_id") REFERENCES "landing_demo_access_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "landing_demo_sign_in_grants" ADD CONSTRAINT "landing_demo_sign_in_grants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "public_rate_limit_counters" (
    "scope" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "count" INTEGER NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "public_rate_limit_counters_pkey" PRIMARY KEY ("scope","key")
);

CREATE INDEX "public_rate_limit_counters_expires_at_idx"
    ON "public_rate_limit_counters"("expires_at");
