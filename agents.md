---
trigger: always_on
---

## Agentic Execution Framework (Superpowers)
You are operating under the `obra/superpowers` methodology. Before generating any code, creating plans, or executing terminal commands, you MUST read the relevant skill from the `.agents/skills/superpowers/` directory.

### Mandatory Workflows:
1. **Planning:** Before writing code or modifying architecture, read `.agents/skills/superpowers/writing-plans/SKILL.md` and create a checklist. Do not proceed until the user approves the plan.
2. **Test-Driven Development (TDD):** When writing code, you MUST follow the Red-Green-Refactor cycle defined in `.agents/skills/superpowers/test-driven-development/SKILL.md`.
3. **Debugging:** If a test fails or a build error occurs, do not guess. Read `.agents/skills/superpowers/systematic-debugging/SKILL.md` and execute the formal root cause analysis.
4. **Brainstorming:** If a user request is vague or open-ended, read `.agents/skills/superpowers/brainstorming/SKILL.md` first.

Do not bypass these rules under any circumstances.

## Project Overview

Auto Core Platform is a multi-tenant workshop operations system: parts inventory, procurement, sales, workshop jobs, vehicle stock, finance, and auth/tenancy.

### Core Modules
- **Inventory**: Tracks automotive parts, storage locations, and stock levels with a full audit trail (ledger-based).
- **Purchase (Procurement)**: Manages purchase orders (POs) from draft to completion, including goods receipt and vendor billing.
- **Sales (CRM & Invoicing)**:
    - **CRM**: Customer management (Private/Company) with full order and vehicle history.
    - **Sales Orders**: Workflow from Draft -> Confirmed -> In Progress -> Completed -> Invoiced.
    - **Invoicing**: Generates final tax invoices from completed sales orders with real-time stock integration.
- **Workshop**: Intake, job cards, board, parts pick, and mechanic tablet queue. Order workflow: Scheduled -> Intake -> In Progress -> Completed -> Invoiced.
- **Vehicle stock**: Dealer-owned vehicles (purchase, stock, sale, vehicle ledger). Separate from parts inventory.
- **Finance**: Manages global fiscal settings (lock dates, numbering) and revenue categorization for accounting exports.
- **Auth/tenancy**: Firebase Auth + JWT guard, row-level `tenant_id` isolation, `TenantMember` roles, and platform super-admin.
- **Brand (Master Data)**: Centralized management of vehicle makes and part manufacturers, enabling consistent categorization and smart filtering.
- **Vendor**: Management of external stakeholders and their associated data (brands, contact info).

## Technology Stack

### Backend (`apps/core-api`)
- **Framework**: NestJS 11 (Node.js)
- **Language**: TypeScript 5.9 (shared major with `apps/core-web`; see ADR-0017)
- **ORM**: Prisma 7
- **Database**: PostgreSQL
- **Validation**: class-validator & class-transformer
- **Testing**: Jest (Unit & E2E)

### Frontend (`apps/core-web`)
- **Framework**: React 19 (Vite 8)
- **Language**: TypeScript 5.9 (shared major with `apps/core-api`; see ADR-0017)
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui
- **State Management**: TanStack Query (v5)
- **Data Grid**: TanStack Table
- **Charts**: Recharts
- **Icons**: Lucide React
- **Notifications**: Sonner

## Architecture & Structure

```text
auto-core-platform/
├── apps/
│   ├── core-api/          # NestJS backend
│   │   ├── prisma/        # Schema and migrations
│   │   └── src/           # Modular services & controllers
│   │       ├── auth/      # Firebase JWT + session
│   │       ├── tenant-member/ # Tenant membership
│   │       ├── brand/     # Brand Master Data
│   │       ├── customer/  # CRM Module
│   │       ├── finance/   # Finance Settings & Revenue Groups
│   │       ├── inventory/ # Inventory & Ledger
│   │       ├── purchase/  # Procurement
│   │       ├── sales/     # Sales Orders & Invoices
│   │       ├── workshop/  # Workshop orders, board, pick
│   │       ├── vehicle-stock/ # Dealer vehicle stock
│   │       └── vendor/    # Vendor Management
│   └── core-web/          # React frontend
│       ├── src/api/       # TanStack Query hooks & types
│       ├── src/components/# UI & Feature components
│       ├── src/hooks/     # Custom React hooks
│       ├── src/pages/     # Routed page components
│       └── src/index.css  # Tailwind theme config
```

## Critical Rules & Development Conventions

### TypeScript Configuration
- **Type Safety**: `verbatimModuleSyntax` is enforced in `apps/core-web`. Use `import type` for all type-only imports (recommended project-wide, required in frontend).
  ```typescript
  // ✅ Correct
  import type { InventoryItem, InventoryResponse } from './types'
  import { useQuery } from '@tanstack/react-query'
  
  // ❌ Wrong - can fail under verbatimModuleSyntax
  import { InventoryItem, InventoryResponse } from './types'
  ```

### Frontend Patterns
- **Tailwind v4**: All styling is defined in `@theme` blocks in `src/index.css`, NOT in `tailwind.config.js`. Utility classes are preferred.
- **shadcn/ui**: Components are located in `src/components/ui/`. Import from `@/components/ui/<component-name>`. Use the `cn()` utility from `@/lib/utils` for conditional classes. Use shadcn/ui primitives when possible.
- **Data Fetching**: Use **TanStack Query** for all API calls. Hooks go in `src/api/` (e.g., `useInventory`, `useInventoryHistory`). API types go in `src/api/types.ts`.
- **Query Key Factories (Strict Enforcement)**: Never use inline hardcoded arrays for React Query keys. All domains must define a standardized factory object (e.g. `invoiceKeys`, `purchaseInvoiceKeys`, `workshopKeys`, `laborKeys`, `vehicleStockKeys`) in their respective hook or service files. Share one factory per domain — do not duplicate keys such as `laborKeys` across modules.
- **Components**: Page components in `src/pages/`, Reusable components in `src/components/`.
- **Navigation & Layout**: Defined in `src/App.tsx`. Navigation is grouped into domains (Sales, Inventory, Procurement, Workshop, Vehicle stock).
- **ID Generation**: Always use the centralized `generateId()` utility from `@/lib/id` instead of direct `crypto.randomUUID()` calls. This ensures compatibility with automated test environments (Playwright) where `crypto.randomUUID` might be unavailable.
- **Settings**: All configuration (Finance, Revenue Groups, Brands, Storage Locations) is consolidated into a unified tabbed page at `src/pages/SettingsPage.tsx`, accessible via the gear icon.

### Page Layout Defaults
- **Main Container**: Wrap page content in `<div className="w-full max-w-7xl mx-auto p-6 space-y-6">` (adjust `space-y-` based on need, `space-y-6` or `space-y-8` is common).
- **Header Section**: Use a flex container for titles and actions:
  ```tsx
  <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4"> {/* Optional gap for back button + title */}
          <div>
              <h1 className="text-2xl font-semibold tracking-tight">Page Title</h1>
              <p className="text-slate-500">Optional subtitle description.</p>
          </div>
      </div>
      <div className="flex gap-2"> {/* Optional container for multiple action buttons */}
          {/* Actions / Buttons go here */}
      </div>
  </div>
  ```
- **Typography/Colors**: Use `text-2xl font-semibold tracking-tight` for main page headers, and `text-slate-500` for subtitles instead of `text-muted-foreground`.
- **Lists / Tables**: Prefer using the shared `DataTable` component abstraction (`@/components/data-table/DataTable`) over constructing raw tables in `src/pages/` components for listing data.

### UX/UI Standards
- **DO**: Place all page-level action buttons (`Create`, `Save`, `Print`, `Delete`, `Export`) aligned to the top-right corner of the page header.
- **DON'T**: Do not place page-level action buttons on the left side under the page title. The top-left is strictly reserved for context (`breadcrumbs`, `titles`, `badges`).

### List Page UI Standard (Required for New Lists)
- **Header**: Use the standard title/subtitle block with `text-2xl font-semibold tracking-tight` and `text-slate-500`.
- **Top-right create action**: Use a plus icon with entity-only label format: `+ <Entity>` (examples: `+ Customer`, `+ Vendor`, `+ Order`, `+ Purchase Order`). Do not use `Add`, `New`, or `Create` in the button label.
- **Search behavior**: Every list must include a search bar and it must search across all relevant visible fields (not only a single column), matching the Item list behavior.
- **Sorting**: Every list must support sortable column headers via the shared `DataTable`/`DataTableColumnHeader` pattern, consistent with other primary lists.
- **Column sizing**: Keep column widths consistent across lists and use the Item list proportions as the reference baseline to avoid layout drift between modules.
- **Status rendering**: Use the shared `StatusBadge` component (`@/components/status/StatusBadge`) for status cells and status chips to keep font size, spacing, and color mapping consistent across the app.
- **Row interaction**: Clicking a table row must open that entity's detail card/page. Avoid separate row-level edit/detail icon buttons in list rows.
- **Row context action**: Right-clicking a row should expose a contextual `Delete` action (when the entity supports deletion).

### Form Handling & UX (Auto-Saving)
We use a **Context-Based Approach**, allowing both patterns strictly based on the UI complexity:
- **Rule for Complex Documents**: For multi-field document creation/editing (e.g., Purchase Bills, Sales Orders, Invoices), strictly enforce **Debounced Form-Level Auto-Save (750ms)**. Ensure there is a persistent visual "Saving/Saved/Error" indicator near the form actions.
- **Rule for Isolated Fields**: For single, isolated text edits (e.g., updating a "Note" field, renaming a task, or quick inline status changes), the **Field-Level Save-on-Blur** utilizing the shared `InlineEdit` component is the approved pattern.

### UI Styling & Standards
- **Status Badges**: Always use the shared `@/components/status/StatusBadge` component for rendering entity statuses. Never construct raw status badges with hardcoded Tailwind colors inline. If a new status is introduced, you must update the `statusClassMap` inside `StatusBadge.tsx` to ensure consistent color mapping across the entire application.

### Real-Time Sync
- **Backend Emission**: The backend uses Prisma `$extends` (`createDashboardRealtimeExtension`) to automatically emit WebSocket events upon entity mutations (`CREATED`, `UPDATED`, `DELETED`). The `DashboardRealtimeService` orchestrates these, and `DashboardGateway` broadcasts them via Socket.IO.
- **Frontend Sync**: The frontend `RealtimeDashboardSyncProvider` connects to the WebSocket endpoint and automatically invalidates the appropriate TanStack Query caches based on `entity_updated` events. Mapping between backend entity types and frontend cache keys is maintained in `src/features/realtime/dashboard-entity-map.ts`.

### Backend Patterns
- **Services**: Business logic stays in services; controllers handle HTTP routing. Services go in feature modules (e.g., `src/inventory/inventory.service.ts`).
- **Transactions & Concurrency**: Services must use `prisma.$transaction` for atomic operations involving multiple tables (e.g., PO and Inventory Ledger updates). To prevent race conditions during updates, use atomic checks and row locking via `updateMany` (e.g., `where: { id, status: DRAFT }`) inside the transaction to ensure the entity state hasn't changed before performing nested mutations.
- **Error Handling**: Use standard NestJS HTTP exceptions (`BadRequestException`, `NotFoundException`, etc.) with clear, descriptive error messages.
- **Prisma**: Use `PrismaService` for all DB operations. Schema uses `snake_case` via `@@map()`. Always run `npx prisma generate` after schema changes. Seed data is in `prisma/seed.ts`. Use `npx prisma migrate dev` for development migrations.
- **Validation**: Global `ValidationPipe` is enabled in `main.ts` with `whitelist: true` and `transform: true`. Use `class-validator` and `class-transformer` extensively in validation DTOs.
- **Tenant Isolation (Critical — Zero-Tolerance)**: Every Prisma query against a tenant-scoped model **must** include `tenant_id: tenantId` in its `where` clause. This applies to all read queries (`findMany`, `findFirst`, `findUnique`), write validation lookups, and any `include`/subquery that resolves a related entity the caller owns. Omitting `tenant_id` is a cross-tenant data leak vulnerability. The `tenantId` must be obtained from `this.tenantContext.getTenantId()` at the top of each service method — never trust an ID supplied directly from the request body for scoping. Tenant-scoped models are those with a `tenant_id` column (e.g., `Employee`, `Bay`, `Customer`, `Vehicle`, `WorkshopOrder`, `InventoryStock`, etc.).
  - 🔴 **DON'T:** `prisma.employee.findMany({ where: { role: 'MECHANIC' } })` — leaks employees from all tenants.
  - 🟢 **DO:** `prisma.employee.findMany({ where: { tenant_id: tenantId, role: 'MECHANIC' } })`
  
### API Conventions
- **Prefix**: All endpoints are prefixed with `/api`.
- **Formatting**: List endpoints return `{ data, meta }` format for list endpoints. Use pagination with `page` and `limit` query params.
- **Proxy**: Vite handles `/api` proxying to backend `http://127.0.0.1:3000` in dev mode.

### API Contract Source of Truth
- **OpenAPI is authoritative**: Backend contract is generated to `apps/core-api/openapi/openapi.json`.
- **Frontend types are generated**: Use `apps/core-web/src/api/generated/openapi.ts` from OpenAPI instead of manually duplicating DTO contracts.
- **Mandatory whenever backend API shape changes**: If you add or change any controller route, request/response DTO, Swagger decorator metadata, or anything else that can affect OpenAPI output, you must regenerate and commit both contract artifacts before finishing the task.
- **Required update flow when backend DTO/controller contract changes**:
  1. `npm --prefix apps/core-api run openapi:generate`
  2. `npm --prefix apps/core-web run api:types:generate`
  3. Commit both generated files.
- **PR check reminder**: Forgetting to commit either regenerated file will fail the PR build on contract drift, even if local builds/tests pass.
- **CI enforcement**: PR workflow regenerates OpenAPI + frontend generated types and fails on drift.

### Testing Standards
- **Write integration tests for each feature module**:
  - Focus on end-to-end flows (e.g., creating a PO and receiving items, Customer -> Sales Order -> Invoice).
  - Backend tests go in `apps/core-api/test/` as `.e2e-spec.ts` files.
  - Use the established testing patterns (e.g., `test/purchase-receipt.e2e-spec.ts`).
  - Ensure tests cover both happy paths and error cases.

## GitHub Pull Request Workflow

### ⚠️ Critical: Always use `gh` CLI, never use browser or GitHub MCP
- **Never** use the browser to create PRs - the UI can be slow or require manual interaction
- **Never** use `github-mcp-server` for PR creation - use it only for read operations (get commits, list issues, etc.)
- **Always** use `gh pr create` from the command line to create pull requests
  ```bash
  gh pr create --title "Your PR title" --body "Your PR description"
  ```
- This is faster, more reliable, and avoids UI-related issues or authentication problems

### Mandatory backend checks before creating a PR
All of the following CI-equivalent backend checks must pass before creating a PR:
```bash
npm exec --workspace=core-api -- prisma generate
npm run lint:prisma-tenant --workspace=core-api
npm run lint --workspace=core-api
npm run build --workspace=core-api
npm test --workspace=core-api -- --ci --runInBand
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm exec --workspace=core-api -- prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm run test:e2e --workspace=core-api -- --ci --runInBand
```
The E2E check must use a fresh, unseeded `auto_core_test` database, migrate it before the test, and run serially. Follow the existing [Cursor Cloud specific instructions](#cursor-cloud-specific-instructions) for the database setup and E2E guidance.

## Database Schema Highlights

- **Tables**: use snake_case via `@@map()` directive.
- **IDs**: are UUIDs.
- **Timestamps**: Use `createdAt` and `updatedAt` timestamps.
- **Supersession chains**: use self-referencing relations.
- **Centralized Brands**: Uses `Brand` entity to standardize vehicle makes and part manufacturers.
- **Row-level tenancy**: Tenant-scoped models include `tenant_id`. Every query against those models must filter by `tenant_id` from `TenantContextService`.
- **Ledger-based Inventory**: Every stock movement is recorded in `InventoryTransaction`.
- **Workshop**: `WorkshopOrder` / `WorkshopTask` job cards; parts pick writes inventory transfers.
- **Vehicle stock**: `VehiclePurchase` / `VehicleSale` / `VehicleLedgerEntry` — dealer cars, not parts inventory.
- **Fiscal Security**: Transactions are validated against `FinanceSettings.lock_date`.
- **Purchase Orders**: follow a strict status workflow (DRAFT -> SENT -> PARTIAL -> COMPLETED).
- **Sales Workflow**:
  - `Customer` (Private/Company) -> `SalesOrder` (Draft) -> `Invoice` (Final).
  - Numbering: Sequential numbering for Sales Orders (`SO-2026-XXXX`) and Invoices (`RE-2026-XXXX`).
  - Invoice Snapshot: Invoices snapshot `revenue_group_name` and `unit_price` at the moment of sale.
- **Relations**:
  - `InventoryStock` is one-to-many with `CatalogItem` (allows multiple locations).
  - `SalesOrder` links to `Customer` and optionally `Vehicle`.

## Building and Running

### Prerequisites
- Node.js v20+ (v22 recommended)
- PostgreSQL v15+
- npm v9+

### Setup Commands
```bash
# Install all workspace dependencies (from repo root)
npm install

# Database Initialization
cd apps/core-api
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

### Development Servers & Common Commands
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

## Known Troubleshooting & Gotchas
1. **Blank page in browser?** Check Vite terminal for CSS errors / Tailwind Utility Errors (Check `@theme` block format in `index.css`).
2. **Import errors?** Ensure type-only imports use `import type`.
3. **Prisma errors / Type Errors?** Run `npx prisma generate` after pulling schema changes.
4. **API 404s?** Confirm backend is running on port 3000 and proxy is active.

## Entity Deletion Policy
- Source of truth: `docs/deletion-policy.md`
- Apply policy before adding any new delete endpoint or UI delete action.
- Backend must enforce all deletion rules; frontend should only mirror policy for UX, never replace backend validation.
- **Maintenance**: The AI MUST automatically propose updates to `docs/deletion-policy.md` whenever a new database entity is created or when business rules regarding the lifecycle of an existing entity are altered.

## MCP Servers & Skills
This project uses the following MCP servers:
- **mcp-server-neon**: For managing the Neon PostgreSQL database (branching, migrations, etc.).
- **github-mcp-server**: For GitHub operations.
- **prisma-mcp-server**: For database schema management.

Use the `mcp-server-neon` skills for database operations like creating branches or running migrations.

### Skill trees
Canonical skills live in `.agents/skills/` (Superpowers at `.agents/skills/superpowers/`). Codex and Cursor consume that tree — do not add `.codex/skills/` or `.cursor/skills/` copies. `docs/internal/.agents/skills/` (architecture vault) and `apps/core-api/.agents/skills/` (Neon) are separate, non-duplicate trees.

### Local Project Skills
- **Stitch Fetch Skill**: `.agents/skills/stitch-fetch/SKILL.md`
  - Use it to fetch Stitch screen metadata and download image/code assets via hosted URLs using `curl -L`.
- **Mintlify Docs Skill**: `.agents/skills/mintlify-docs/SKILL.md`
  - Use it before writing or editing public Mintlify pages (`*.mdx`, `docs.json`). Enforces ACP workshop voice and the unique Mintlify design.
- **Tracing Request IDs Skill**: `.agents/skills/tracing-request-ids/SKILL.md`
  - Use it when debugging from a request id, `x-request-id`, Sentry Error ID, or Cloud Logging `http_error` line.

## Google Secret Manager (Shared Dev Secrets)

Use Google Secret Manager (GSM) as the source of truth for local dev credentials across machines and agents.

### Files
- Mapping template: `secrets/gsm-mapping.example.json`
- Local mapping (gitignored): `secrets/gsm-mapping.json`
- Pull script: `tools/pull-secrets-from-gsm.mjs`
- Full guide: `docs/google-secret-manager.md`

### One-time Setup (per machine)
1. `gcloud auth login`
2. `gcloud config set project auto-core-platform-vande`
3. `Copy-Item secrets/gsm-mapping.example.json secrets/gsm-mapping.json`
4. Update `secrets/gsm-mapping.json` secret names to match your GSM secrets.

### Pull Secrets
- Backend env (`apps/core-api/.env`):
  - `npm --prefix apps/core-api run secrets:pull`
- Frontend env (`apps/core-web/.env.local`):
  - `npm --prefix apps/core-web run secrets:pull`

Never commit real secret values or generated local `.env` files.

## Database Performance
🔴 **DON'T:** Never execute an `await` database query (read or write) inside a loop (N+1 anti-pattern).
🟢 **DO:** For reads, use the "Pre-fetch & Map" pattern with `in:` queries. For writes, map the data to an array of Prisma queries and resolve them concurrently using our global chunking utility `chunkedPromiseAll` inside a transaction.

## Cursor Cloud specific instructions

This section captures non-obvious, durable setup notes for Cloud Agents. Standard commands live in `README.md` and the root `package.json` workspace scripts; only the caveats below are cloud-specific. The startup update script already runs root `npm ci` plus `prisma generate`.

### Services
- **PostgreSQL 15+** on `localhost:5432` (installed via apt as PG 16). Local dev DB is `core_platform`, credentials `postgres` / `postgres`. A separate empty `auto_core_test` DB exists for e2e.
- **Backend** (`apps/core-api`) — NestJS on port `3000`: `npm run start:dev`. Requires `apps/core-api/.env` (already created, gitignored) with `DATABASE_URL` and a base64 32-byte `SECRET_ENCRYPTION_KEY`; the process throws on startup if `SECRET_ENCRYPTION_KEY` is missing/invalid.
- **Frontend** (`apps/core-web`) — Vite/React on port `5173`: `npm run dev`. It proxies `/api` and `/socket.io` to `127.0.0.1:3000`.

### Postgres is not auto-started on boot
`systemd`/`invoke-rc.d` is disabled in this VM, so Postgres does not start automatically. Start it before running the backend, tests, or seeds:
```
sudo pg_ctlcluster 16 main start
```

### Backend e2e tests must use a fresh, unseeded DB, serially
CI runs e2e against a fresh, unseeded `auto_core_test` DB, applies migrations before the test, and uses `--ci --runInBand` (see `.github/workflows/build.yaml`). Running e2e against the **seeded** `core_platform` DB, or in parallel, causes non-deterministic failures (leftover tenants / cross-suite `deleteMany`). Run e2e like CI:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm --prefix apps/core-api exec -- prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm --prefix apps/core-api run test:e2e -- --ci --runInBand
```
Jest auto-sets `NODE_ENV=test`, which enables locally-signed test JWTs (no Firebase needed for tests). Unit tests (`npm test`) and the frontend Playwright e2e (`npm run test:e2e`, needs `npx playwright install chromium`) do not need a seeded DB.

### The seed is not idempotent when transactional rows exist
`prisma db seed` deletes all tenants then recreates `default-workshop` with a **new** id, but its delete order does not cover `sales_orders`, so re-seeding a DB that already has sales orders fails with an FK error. To reset the dev DB cleanly, drop and recreate it:
```
sudo -u postgres psql -c "DROP DATABASE core_platform WITH (FORCE);"
sudo -u postgres psql -c "CREATE DATABASE core_platform;"
npm --prefix apps/core-api exec -- prisma migrate deploy
npm --prefix apps/core-api run <or> npx prisma db seed   # from apps/core-api
```

### Interactive login with real Firebase (works, no service account required)
All backend routes are behind a global `JwtAuthGuard`, and the frontend login uses Firebase Auth for project `auto-core-platform-vande`. Real interactive login works with these steps (no Google service account needed):

1. Frontend config — the web config is public (shipped to browsers) and discoverable from Firebase Hosting:
   `curl https://auto-core-platform-vande.firebaseapp.com/__/firebase/init.json`
   Put `apiKey`, `authDomain`, `projectId`, `appId` into `apps/core-web/.env.local` as `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID`, then restart Vite. (`cloudbuild.yaml` lists all of these except the api key.)
2. Backend config — set `FIREBASE_PROJECT_ID=auto-core-platform-vande` in `apps/core-api/.env`. `verifyIdToken()` only needs the project id (it fetches Google's public certs); Application Default Credentials are NOT required to *verify* tokens.
3. Authorize the user in the local DB — the session is resolved from local `User` + `TenantMember` rows, not from token claims. `npm run db:seed:tenant-member` cannot be used here because it calls Firebase Admin (`getUserByEmail`/`setCustomUserClaims`), which needs a service account. Instead insert the rows directly: create a `User` (`firebaseUid` = the sign-in `localId`, matched by email otherwise) with `active_tenant_id` = the `default-workshop` tenant id, and a `TenantMember` (role `ADMIN`, `is_active: true`) for that tenant. The test user `testauto@auto.core.at` is already linked in the current dev DB.

For a **TECH/mechanic** login (tablet mode at `/mechanic/queue`), the `TenantMember` role must be `TECH` and — in addition — `MechanicService.resolveMechanic()` requires an active `Employee` (role `MECHANIC`, `is_active: true`) whose `user_id` points at that `User`. The queue only shows `WorkshopTask` rows assigned to that employee (`mechanic_id`) with a `scheduled_date` around today. Both `testauto@auto.core.at` (ADMIN) and `tablet-mechanic@auto.core.at` (TECH, with a linked mechanic employee and a demo `WO-DEMO-0001` order) are set up in the current dev DB.

Alternatives without Firebase: run Vite with `VITE_E2E_SKIP_AUTH=true` to render the app shell (API calls then 401, no token attached); or run the backend with `NODE_ENV=test` + a known `TEST_JWT_SECRET` and mint an HS256 JWT with claims `{ sub, email, iss: 'local-test-fixture' }` that match a seeded `User` + active `TenantMember` (request authorization is resolved from Postgres, not from token `tenantId`/`role` claims).

### Build/run gotcha
The compiled entrypoint is `dist/src/main.js` (not `dist/main.js`). Do not run a `dist`-based server while `npm run start:dev` (watch) is recompiling `dist` — they race and cause `Cannot find module` errors.

### Lint state
`apps/core-api` `npm run lint` runs ESLint without `--fix` (PR CI uses the same command). Use `npm run lint:fix` to apply auto-fixes locally. `apps/core-web` `npm run lint` passes with a couple of warnings.
