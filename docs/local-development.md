# Local development

How to set up, run and log in to ACP locally. Agent rules live in [agents.md](../agents.md); Cursor Cloud Agents also follow `.cursor/rules/cursor-cloud.mdc`.

## Prerequisites
- Node.js 26 (exact version in `.nvmrc`)
- PostgreSQL v15+
- npm v9+

## Setup
```bash
# Install all workspace dependencies (from repo root)
npm install

# Database Initialization
cd apps/core-api
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

## Development servers and common commands
```bash
# Backend (Port 3000)
cd apps/core-api
npm run start:dev          # Start with hot reload
npx prisma studio          # Database GUI
npx prisma migrate dev     # Apply migrations
npx prisma db seed         # Seed sample data

# Frontend (Port 5173)
cd apps/core-web
npm run dev                # Start dev server
npm run build              # Production build
```

## Troubleshooting and gotchas
1. **Blank page in browser?** Check Vite terminal for CSS errors / Tailwind Utility Errors (Check `@theme` block format in `index.css`).
2. **Import errors?** Ensure type-only imports use `import type`.
3. **Prisma errors / Type Errors?** Run `npx prisma generate` after pulling schema changes.
4. **API 404s?** Confirm backend is running on port 3000 and proxy is active.

## The seed is not idempotent when transactional rows exist
`prisma db seed` deletes all tenants then recreates `default-workshop` with a **new** id, but its delete order does not cover `sales_orders`, so re-seeding a DB that already has sales orders fails with an FK error. Prefer the reset commands above instead of re-running seed on a dirty dev DB.

## Interactive login with real Firebase (works, no service account required)
All backend routes are behind a global `JwtAuthGuard`, and the frontend login uses Firebase Auth for project `auto-core-platform-vande`. Real interactive login works with these steps (no Google service account needed):

1. Frontend config — the web config is public (shipped to browsers) and discoverable from Firebase Hosting:
   `curl https://auto-core-platform-vande.firebaseapp.com/__/firebase/init.json`
   Put `apiKey`, `authDomain`, `projectId`, `appId` into `apps/core-web/.env.local` as `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID`, then restart Vite. (`cloudbuild.yaml` lists all of these except the api key.)
2. Backend config — set `FIREBASE_PROJECT_ID=auto-core-platform-vande` in `apps/core-api/.env`. `verifyIdToken()` only needs the project id (it fetches Google's public certs); Application Default Credentials are NOT required to *verify* tokens.
3. Authorize the user in the local DB — the session is resolved from local `User` + `TenantMember` rows, not from token claims. `npm run db:seed:tenant-member` cannot be used here because it calls Firebase Admin (`getUserByEmail`/`setCustomUserClaims`), which needs a service account. Instead insert the rows directly: create a `User` (`firebaseUid` = the sign-in `localId`, matched by email otherwise) with `active_tenant_id` = the `default-workshop` tenant id, and a `TenantMember` (role `ADMIN`, `is_active: true`) for that tenant.

For a **TECH/mechanic** login (tablet mode at `/mechanic/queue`), the `TenantMember` role must be `TECH` and — in addition — `MechanicService.resolveMechanic()` requires an active `Employee` (role `MECHANIC`, `is_active: true`) whose `user_id` points at that `User`.

Alternatives without Firebase: run Vite with `VITE_E2E_SKIP_AUTH=true` to render the app shell (API calls then 401, no token attached); or run the backend with `NODE_ENV=test` + a known `TEST_JWT_SECRET` and mint an HS256 JWT with claims `{ sub, email, iss: 'local-test-fixture' }` that match a seeded `User` + active `TenantMember` (request authorization is resolved from Postgres, not from token `tenantId`/`role` claims).

## Build/run gotcha
The compiled entrypoint is `dist/main.js` (not `dist/src/main.js`). Do not run a `dist`-based server while `npm run start:dev` (watch) is recompiling `dist` — they race and cause `Cannot find module` errors.

## Lint state
`apps/core-api` `npm run lint` runs ESLint without `--fix` (PR CI uses the same command). Use `npm run lint:fix` to apply auto-fixes locally. `apps/core-web` `npm run lint` passes with a couple of warnings.
