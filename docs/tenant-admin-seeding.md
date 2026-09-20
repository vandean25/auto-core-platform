# Tenant Admin Seeding Scripts

This document explains how to use scripts for:

- promoting a user to `SUPER_ADMIN`
- adding a user as a member of a specific tenant

## Prerequisites

- `apps/core-api/.env` has a valid `DATABASE_URL`
- Firebase Admin credentials are configured for the API runtime
- You run commands from repo root: `C:\Git\auto-core-platform`

## 1) Promote a User to SUPER_ADMIN

Script: `apps/core-api/scripts/seed-platform-admin.ts`

Command:

```bash
npm --prefix apps/core-api run db:seed:platform-admin -- --email=testauto@auto.core.at
```

What it does:

- resolves/creates the Firebase user by email
- ensures a relational `users` row exists
- upserts an active `platform_admins` row with role `SUPER_ADMIN`
- updates Firebase custom claims with `platformRole: SUPER_ADMIN`

## 2) Add a User as Tenant Member

Script: `apps/core-api/scripts/seed-tenant-member.ts`

Command (default role `ADMIN`):

```bash
npm --prefix apps/core-api run db:seed:tenant-member -- --email=testauto@auto.core.at --tenant-slug=uitz
```

Command (explicit role, and set tenant as active immediately):

```bash
npm --prefix apps/core-api run db:seed:tenant-member -- --email=testauto@auto.core.at --tenant-slug=uitz --role=OWNER --make-active
```

Supported roles:

- `OWNER`
- `ADMIN`
- `TECH`
- `SALES`

What it does:

- finds tenant by `slug`
- resolves/creates Firebase user by email
- ensures/updates relational `users` row
- upserts active `tenant_members` row for `(tenant_id, user_id)`
- for `TECH` role: links or creates an active `MECHANIC` employee with `user_id` set (required for `/mechanic/queue` identity resolution per ADR-0014)
- grants active `site_memberships` on every active tenant site (same as AUT-290 demo QA access)
- refreshes Firebase claims (`tenantId`, `role`, and keeps `platformRole` if present)

### UAT mechanic login (`grok-bot-tech`)

Mechanic tablet sessions need **both** a `TECH` tenant membership and a linked `Employee` row (`role = MECHANIC`, `user_id` pointing at the same `users.id`). Workshop board assignment uses `Employee.id` only; the tablet queue resolves the mechanic from the login.

After a full UAT re-seed:

```bash
npm --prefix apps/core-api run db:seed
npm --prefix apps/core-api run db:seed:tenant-member -- --email=grok-bot-tech@auto.core.at --tenant-slug=default-workshop --role=TECH --make-active
```

The tenant-member script will:

1. create/update the Firebase + `users` row for `grok-bot-tech@auto.core.at`
2. upsert `tenant_members` with role `TECH`
3. link an existing unlinked `Grok Bot` mechanic employee when present, otherwise create one with a default work schedule

Verify in HR (`/hr/employees`): **Grok Bot** should show **Login: linked**. Sign in as the mechanic and open `/mechanic/queue`; assigned tasks appear after workshop board assignment.

## 3) Apply Changes in UI

After running either script:

1. Sign out and sign in again, or hard refresh to force token refresh.
2. Open sidebar tenant switcher and select the target tenant if needed.
3. Go to `Settings -> Team` to manage members in the active tenant.

## Troubleshooting

- `Tenant with slug "<slug>" was not found.`:
  - verify slug on `/platform/tenants` or in DB.
- `Failed to resolve Firebase user...`:
  - check Firebase admin credentials and project config.
- role/tenant UI not updating:
  - sign out/in to refresh Firebase ID token and custom claims.
