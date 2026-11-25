---
trigger: always_on
---

## Agentic Execution Framework (Superpowers)
You are operating under the `obra/superpowers` methodology. Before writing code, debugging or reporting work complete, you MUST read the relevant mandatory skill listed below from the `.agents/skills/superpowers/` directory.

### Mandatory Workflows:
1. **Test-Driven Development (TDD):** For behaviour changes and bugfixes, you MUST follow the Red-Green-Refactor cycle (failing test first) defined in `.agents/skills/superpowers/test-driven-development/SKILL.md`. For pure refactors the existing tests are the safety net; no new tests are required. The skill's "wrote code before the test? delete it" rule does not apply in ACP.
2. **Debugging:** If a test fails or a build error occurs, do not guess. Read `.agents/skills/superpowers/systematic-debugging/SKILL.md` and execute the formal root cause analysis.
3. **Verification:** Before reporting work as complete, read `.agents/skills/superpowers/verification-before-completion/SKILL.md` and run its checks.

Only load the three mandatory superpowers skills listed above. Specs are settled upstream in Linear. The other obra/superpowers skills are not kept in this repo.

Do not bypass the mandatory workflows under any circumstances.

## Project Overview

Auto Core Platform is a multi-tenant workshop operations system. Modules: **Inventory** (parts, storage locations, ledger-based stock), **Purchase** (POs from draft to completion, goods receipt, vendor bills), **Sales** (CRM for private/company customers; sales orders Draft -> Confirmed -> In Progress -> Completed -> Invoiced; invoices from completed sales orders), **Workshop** (intake, job cards, board, parts pick, mechanic tablet queue; Scheduled -> Intake -> In Progress -> Completed -> Invoiced), **Vehicle stock** (dealer-owned vehicles, separate from parts inventory), **Finance** (fiscal settings, lock dates, numbering, revenue groups, accounting export), **Auth/tenancy** (Firebase Auth + JWT guard, row-level `tenant_id`, `TenantMember` roles, platform super-admin), **Brand** and **Vendor** master data.

Stack: `apps/core-api` is NestJS 11 + Prisma 7 + PostgreSQL + class-validator, tested with Jest (unit and e2e). `apps/core-web` is React 19 (Vite 8) + Tailwind CSS 4 + shadcn/ui + TanStack Query v5 / Table, Recharts, Lucide, Sonner. Both use TypeScript 7.0 (`tsc`; TS 6 shim for eslint/ts-node, ADR-0017). Backend modules live in `apps/core-api/src/<module>/`, schema and migrations in `apps/core-api/prisma/`; frontend hooks in `src/api/`, pages in `src/pages/`, components in `src/components/`, theme in `src/index.css`.

Local setup, dev servers, interactive login, seeding and troubleshooting: [docs/local-development.md](docs/local-development.md). Node.js **26.13.1** from `.nvmrc`.

## Critical Rules & Development Conventions

### TypeScript Configuration
- **Type Safety**: `verbatimModuleSyntax` is enforced in `apps/core-web`. Use `import type` for all type-only imports (recommended project-wide, required in frontend): `import type { InventoryItem } from './types'`, never `import { InventoryItem } from './types'` for a type.

### Frontend Patterns
- **Tailwind v4**: All styling is defined in `@theme` blocks in `src/index.css`, NOT in `tailwind.config.js`. Utility classes are preferred.
- **shadcn/ui**: Components are located in `src/components/ui/`. Import from `@/components/ui/<component-name>`. Use the `cn()` utility from `@/lib/utils` for conditional classes. Use shadcn/ui primitives when possible.
- **Data Fetching**: Use **TanStack Query** for all API calls. Hooks go in `src/api/` (e.g., `useInventory`, `useInventoryHistory`). API types go in `src/api/types.ts`.
- **Query Key Factories (Strict Enforcement)**: Never use inline hardcoded arrays for React Query keys. All domains must define a standardized factory object (e.g. `invoiceKeys`, `purchaseInvoiceKeys`, `workshopKeys`, `laborKeys`, `vehicleStockKeys`) in their respective hook or service files. Share one factory per domain — do not duplicate keys such as `laborKeys` across modules.
- **Components**: Page components in `src/pages/`, Reusable components in `src/components/`.
- **Navigation & Layout**: Defined in `src/App.tsx`. Navigation is grouped into domains (Sales, Inventory, Procurement, Workshop, Vehicle stock).
- **ID Generation**: Always use the centralized `generateId()` utility from `@/lib/id` instead of direct `crypto.randomUUID()` calls. This ensures compatibility with automated test environments (Playwright) where `crypto.randomUUID` might be unavailable.
- **Settings**: All configuration (Finance, Revenue Groups, Brands, Storage Locations) is consolidated into a unified tabbed page at `src/pages/SettingsPage.tsx`, accessible via the gear icon.
- **Action Registry & Action IDs**: Shared record/page actions live in `src/features/actions/entity-action.ts` using stable `<entity>.<action>` IDs with optional dot-separated child segments (`<entity>.<action>.<segment>...`, e.g., `customer.delete`, `workOrder.jobCardPdf`, `workOrder.taskState.t1.done`), exposed on page action buttons via `data-action-id` (`RegistryActionButton`) and gated through `src/features/actions/action-role-predicates.ts`. Every record action on an ACP page must be a registry action reachable via Cmd+K with identical role gating and confirmations. This is enforced by `src/features/actions/registry-parity.test.ts` against `src/features/actions/registry-parity.baseline.json`: new `onClick` `Button`/`DropdownMenuItem` or `AlertDialogTrigger` elements in `src/pages/` or `src/features/` without a registered `data-action-id` fail CI, and migrating an existing action requires deleting its entry from `registry-parity.baseline.json` (the baseline may only shrink). Dialog footers (`DialogFooter`, `AlertDialogFooter`, `SheetFooter`), settings/admin configuration screens, and the mechanic touch UI are excluded.

### Frontend interaction rules

This is the **single entry point for coding agents**; the contract and rationale live in [ADR-0036 Frontend interaction rules](docs/internal/01-ADR/2026-11-02-frontend-interaction-rules.md). Do not copy these rules into `.cursor/rules`, `CLAUDE.md` or skills; link here instead. Static guards prove wiring, not business safety: reversibility, authorization and concurrency still need tests.

**Shared APIs (use these, never a per-page substitute)**

| Rule | Use | Where |
|---|---|---|
| R1 optimistic updates | `optimisticMutationOptions` plus a `mutationKey` and an inventory entry | `src/lib/optimistic-mutation.ts` |
| R2 loading and pending | 200 ms skeleton delay, 350 ms minimum, 200 ms refresh indicator | `src/features/interaction/loading-timings.ts` |
| R3 undo | latest eligible undo entry | `src/features/interaction/undo-eligible-entry-store.ts` |
| R4 intent prefetch | `rowBehaviour.onRowPrefetch` calling `scheduleDetailPrefetch` | `src/lib/intent-prefetch.ts` |
| R5 keyboard | `useShortcutHandler` and registry `shortcutKey` | `src/features/shortcuts/shortcut-dispatcher.ts`, `src/features/actions/entity-action.ts` |
| R6 motion | `motionDurationClass` / `motionDurationMs`: 150 ms finite, 200 ms sheets and dialogs | `src/lib/motion-tokens.ts` |
| R7 infinite lists | shared infinite mode, explicit refresh (ADR-0035) | `src/lib/infinite-list-query.ts` |

**CI guards (all run in the frontend unit tests; baselines are checked in)**

| Guard | Fails when | Satisfy it by | Baseline |
|---|---|---|---|
| Mutation classification (`features/interaction/guards/mutation-classification.test.ts`) | a `useMutation` (also via alias, namespace import or an unregistered wrapper) has no resolvable `mutationKey`, no inventory entry for its owning hook, or is classified optimistic without `optimisticMutationOptions` | step list below; a comment is never an exemption | `mutation-classification.baseline.json`, plus `mutation-key.baseline.json` for the workshop pilot |
| Intent prefetch (`intent-prefetch.test.ts`) | a navigable `DataTable` consumer (row click or href) does not route `onRowPrefetch` through `scheduleDetailPrefetch` | wire it, or add a reasoned entry to `intent-prefetch-exceptions.json` (list has no detail target) | `intent-prefetch.baseline.json` |
| Keyboard uniqueness (`features/actions/registry-parity.test.ts`) | a `shortcutKey` repeats within a list, is reserved, shadows a global key or `g`-sequence key, or a handler is registered outside the dispatcher | pick a free single key; register through `useShortcutHandler`; add a new list to `REAL_ROW_SURFACES` | `registry-parity.shortcuts.baseline.json` |
| Transition duration (`transition-duration.test.ts`) | a finite transition above 200 ms, or a duration that cannot be resolved statically (variable, interpolated class, unknown CSS variable) in Tailwind, CSS, framer-motion or other JS | use the motion tokens; repeating indicators (`animate-spin`, `repeat: Infinity`, `infinite`) are classified separately; debounce, delay and toast timings are not transitions | `transition-duration.baseline.json` |
| StatusBadge (`features/interaction/guards/status-badge.test.ts`) | a production `.tsx` file outside `components/status/` and `components/ui/` uses ad hoc `bg-(success\|warning\|destructive\|info)/<n>` (`tinted-tone`) or defines a local status-to-class map (`local-status-map`), or a `statusClassMap` key lacks a `de`/`en` label | use `StatusBadge` + `statusClassMap`, and add `de`/`en` labels under `enums:status.*` | `status-badge.baseline.json` |

**Baseline rules.** A baseline lists the violations that existed when its guard was activated. Current code must match it exactly: a violation missing from the baseline fails, and a baseline line whose violation is gone fails as stale. Removing a violation means removing its exact baseline line in the same change (`UPDATE_INTERACTION_BASELINES=1 npm test --workspace=core-web -- src/features/interaction/guards src/features/actions/registry-parity.test.ts` rewrites the files; review the diff). A baseline may only shrink: `npm run interaction-baselines:check` (CI step "Verify interaction guard baselines did not grow") rejects any added line against the PR base. Never rename, suppress, stub or broaden a baseline to pass. Reasoned exceptions (`intent-prefetch-exceptions.json`) and legitimate server-confirmed classifications are separate reviewed inventories, not debt.

**Target vs current behavior:** `classification` in the inventories is the ADR **target**. Hooks that still spread `optimisticMutationOptions` while classified `server-confirmed` must appear in `unmigrated-optimistic-consumers.baseline.json` until P4 removes the helper usage. A hook classified `optimistic` that does not use the helper is a baselined `optimistic-without-helper` violation until it migrates.

**Keyboard shortcuts (R5):** single-key shortcuts go through the one dispatcher (scopes `row` > `global`, dialogs suspend both). Do not add `useHotkeys` for plain character keys. A record action gets its key via `shortcutKey` on the registry definition; child actions cannot carry one. The per-user "Single-key shortcuts" setting (localStorage, account menu) switches every dispatcher key off; Cmd/Ctrl combos stay outside it.

**Adding a mutation (any module)**

1. Implement the TanStack `useMutation` hook (or reuse a registered wrapper) in the appropriate `src/api/` module. A new wrapper around `useMutation` or `optimisticMutationOptions` must be registered in `REGISTERED_MUTATION_WRAPPERS` (`features/interaction/guards/mutation-classification.ts`) with guard coverage before it is used.
2. Assign a stable **`mutationKey`** in the hook options (or through `optimisticMutationOptions` from `@/lib/optimistic-mutation`). Do not rely on implicit optimistic behavior.
3. Add one inventory entry keyed by **`operationId` + `owningHook`**: in `workshop-mutation-inventory.json` for work orders and the mechanic queue, otherwise in `mutation-inventory.json` (set `sourceFile` when another file exports the same hook name). Set `classification` to `optimistic` (the hook must use `optimisticMutationOptions`), `server-confirmed` (non-empty `serverConfirmedReason` per ADR R1) or `conditional` (`eligibilityPredicate` naming an exported, tested function).
4. Workshop pilot only: a hook that still lacks `mutationKey` stays in `mutation-key.baseline.json` until the key exists. Everywhere else the guard baseline is the only place an existing gap may live; new hooks are never added to it.
5. If the hook still uses `optimisticMutationOptions` but the target is `server-confirmed`, add `operationId` + `owningHook` to `unmigrated-optimistic-consumers.baseline.json`.
6. Extend `workshop-mutation-inventory.test.ts` only when you add a new conditional predicate or change the pilot discovery scope.

Absent inventory entries are gaps, never permission to optimistically mutate.

### Definition of Done

A change is done when:
- Behaviour changes and bugfixes have a test that failed first (TDD workflow above).
- The local checks for the touched workspace pass and the CI result, including `Code Health (Fallow)`, is green.
- User-facing text exists in German and English (ACP i18n skill).
- **Interaction compliance (frontend):** every mutation, `DataTable` list, record-action shortcut and transition the change adds or touches follows [Frontend interaction rules](#frontend-interaction-rules), the four interaction guards pass, and no guard baseline grew.

### Page Layout Defaults
- **Main Container**: Admin routes are wrapped by `PageContainer` in `App.tsx` (`max-w-page mx-auto p-6`). Adjust width via `--container-page` in `src/index.css`. Pages should not repeat that wrapper — use `space-y-6` / `space-y-8` on a root fragment or inner div when vertical spacing is needed.
- **Header Section**: a flex container `flex items-center justify-between mb-8`: on the left an optional back button plus a `<div>` with `<h1 className="text-2xl font-semibold tracking-tight">` and an optional `<p className="text-slate-500">` subtitle (not `text-muted-foreground`); on the right `flex gap-2` with the page actions.
- **Lists / Tables**: Prefer using the shared `DataTable` component abstraction (`@/components/data-table/DataTable`) over constructing raw tables in `src/pages/` components for listing data.

### UX/UI Standards
- **DO**: Place all page-level action buttons (`Create`, `Save`, `Print`, `Delete`, `Export`) aligned to the top-right corner of the page header.
- **DON'T**: Do not place page-level action buttons on the left side under the page title. The top-left is strictly reserved for context (`breadcrumbs`, `titles`, `badges`).

### List Page UI Standard (Required for New Lists)
- **Header**: the standard title/subtitle block from Page Layout Defaults.
- **Top-right create action**: Use a plus icon with either the entity-only label format `+ <Entity>` (examples: `+ Customer`, `+ Vendor`, `+ Order`, `+ Purchase Order`) or a sentence-case `New <entity>` label (examples: `New order`, `New transfer`). Do not use `Add` or `Create` in the button label.
- **Search behavior**: Every list must include a search bar and it must search across all relevant visible fields (not only a single column), matching the Item list behavior.
- **Sorting**: Every list must support sortable column headers via the shared `DataTable`/`DataTableColumnHeader` pattern, consistent with other primary lists.
- **Column sizing**: Keep column widths consistent across lists and use the Item list proportions as the reference baseline to avoid layout drift between modules.
- **Status rendering**: Use the shared `StatusBadge` component (`@/components/status/StatusBadge`) for status cells and status chips (see UI Styling & Standards).
- **Row interaction**: Clicking a table row must open that entity's detail card/page. Avoid separate row-level edit/detail icon buttons in list rows.
- **Row context action**: Right-clicking a row should expose a contextual `Delete` action (when the entity supports deletion).

### Form Handling & UX (Auto-Saving)
We use a **Context-Based Approach**, allowing both patterns strictly based on the UI complexity:
- **Rule for Complex Documents**: For multi-field document creation/editing (e.g., Purchase Bills, Sales Orders, Invoices), strictly enforce **Debounced Form-Level Auto-Save (750ms)**. Ensure there is a persistent visual "Saving/Saved/Error" indicator near the form actions.
- **Rule for Isolated Fields**: For single, isolated text edits (e.g., updating a "Note" field, renaming a task, or quick inline status changes), the **Field-Level Save-on-Blur** utilizing the shared `InlineEdit` component is the approved pattern.

### UI Styling & Standards
- **Status Badges**: Always use the shared `@/components/status/StatusBadge` component for rendering entity statuses. Never construct raw status badges with hardcoded Tailwind colors inline. If a new status is introduced, you must update the `statusClassMap` in `apps/core-web/src/components/status/status-class-map.ts` to ensure consistent color mapping across the entire application.

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
- **Site operational scope (ADR-0022)**: `site_id` is **not** a second Prisma `$extends` filter. Operational models (bays, locations, planner, stock, site-owned documents) are queried with `{ tenant_id: tenantId, site_id: siteContext.getSiteId() }` or a named `listAcrossAuthorizedSites()` helper whose IDs come from **active `SiteMembership` joined to an active `TenantMember`**. Do not take `?siteId=` as authorization. Do not infer a document’s site from the user’s current switcher. Tenant-wide models (catalog, customers, employees, …) have no `site_id`. **Every `include` / subquery / count of a site-owned model** (including nested `sales_orders` / `workshop_orders` on `CustomerService.findOne` and `VehicleService.findOne`) must use the active site or that helper — a tenant-only include is a cross-site leak. CRM vehicle identity stays tenant-wide; dealer-stock `location_id` / lot / `stock_status` / dealer `inventory_role` require lot-site authorization. `GET /api/vehicle-stock/:id` is active-site only (`422 ACTIVE_SITE_REQUIRED` when context is missing; **404** when the lot is another site). **The tenant-change helper is the only production writer of `User.active_tenant_id`** (`switchTenant`, `ensureActiveMembership`, invite auto-assign, `syncUserClaims`); it must also null `User.active_site_id`. Ledger `inventory_transactions.site_id` is **this row’s** `location_id` site, not a pair-level dest site. Site-owned creates, receipts, transfers, and vehicle moves recheck `Site.is_active` under a site-row lock (sorted site ids when two sites). Parked dealer vehicles resolve site from the lot only. Transfer **create and every action response** (not only list/detail) redact `source_location_id` unless the caller has from-site membership.
  
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
- **How to write tests:** follow `.agents/skills/acp-testing/SKILL.md` when adding or changing a spec. It complements the TDD skill, `writing-good-tests.md`, `condition-based-waiting.md`, `clean-tests` and the rules in this section.
- **Deterministic time:** never hard-code a calendar day that is compared with "now" or with a record dated today (the failure mode of `settlement.e2e-spec.ts`: credit-note `date: '2026-11-14'` vs an invoice issued with `new Date()`). Derive the date from the created record, or stamp the whole scenario from one fixture / injected clock and reset it. Backend CI is UTC; the product and Playwright visual tests use `Europe/Vienna`. Think about UTC midnight and month/year/`lock_date` boundaries.
- **Every test proves a regression**: the name (or one short line above it) says which regression it catches, and it must fail against the code before the fix. Check that by reverting the fix once while the test runs.
- **Assert on the system under test**: never green-light a test by only reading back state that the test's own fake, mock or fixture wrote (a fake that echoes what it stored proves nothing about the code).
- **Test comments must match the test**: a comment may only claim what an assertion actually checks; delete claims about cases the test never builds.
- **Doc screenshots**: e2e specs never write into `docs/` on a normal run; they go through `apps/core-web/e2e/utils/doc-screenshot.ts`, which only re-captures them with `UPDATE_DOC_SCREENSHOTS=1`.
- **Extend, don't fork specs**: add a bugfix test to the existing spec for the unit under test, using a shared test factory or builder; never create a new `<file>.<fix>.spec.ts` per bugfix.
- **`it.each` for data variants**: the same flow with different data is one `it.each`, not copied tests.
- **No empty assertions**: no test whose only assertion is `toBeDefined` / "should be defined", or a bare `toHaveBeenCalled()` without an argument or outcome check.
- **Public API only**: never reach into private methods (`as any`, `['privateMethod']`); test through the public API.
- **No mock-heavy duplicates of e2e**: if an existing e2e already covers a flow, extend that e2e or test the pure logic instead of adding a heavily mocked unit test.
- **Spec-quality guard**: `npm run spec-quality:check` (self-test `npm run spec-quality:check:test`, also a step in PR Build Check) fails on NEW low-value tests — specs over 150 lines with two or fewer tests, existence-only assertions, bare `toHaveBeenCalled()`, and `as any` / `['privateMethod']` access; existing offenders are listed in `tools/spec-quality-baseline.json`, which only shrinks (regenerate with `npm run spec-quality:check -- --write-baseline` after deleting offenders).

### Ticket Scenarios (WHEN/THEN)
- Every WHEN/THEN scenario listed in a ticket maps to exactly one test, preferably by extending an existing spec (format borrowed from OpenSpec; we do not adopt OpenSpec itself), unless the ticket changes no behaviour, in which case each scenario maps to the doc section that states it.

### Domain invariants (schema)
- Tables use snake_case via `@@map()`; IDs are UUIDs; models carry `createdAt` / `updatedAt`; supersession chains use self-referencing relations.
- `Brand` standardizes vehicle makes and part manufacturers. `InventoryStock` is one-to-many with `CatalogItem` (multiple locations).
- Every stock movement is an `InventoryTransaction` (ledger). Workshop `WorkshopOrder` / `WorkshopTask` job cards; parts pick writes inventory transfers. Dealer cars use `VehiclePurchase` / `VehicleSale` / `VehicleLedgerEntry`, never parts inventory.
- Transactions are validated against `FinanceSettings.lock_date`. Purchase orders follow DRAFT -> SENT -> PARTIAL -> COMPLETED.
- Sales: `Customer` -> `SalesOrder` (Draft, links `Customer` and optionally `Vehicle`) -> `Invoice` (Final); sequential numbering (`SO-2026-XXXX`, `RE-2026-XXXX`); invoices snapshot `revenue_group_name` and `unit_price` at the moment of sale.

## GitHub Pull Request Workflow

### Creating PRs
- Create PRs with the `gh` CLI (`gh pr create --draft --title "..." --body-file pr-body.md`), never through the browser. GitHub MCP tools are for read operations only.
- **Claude Code cloud sessions:** GitHub access there allows REST only, not GraphQL, so `gh pr create`, `gh pr view` and other GraphQL-based `gh` commands fail. Use `gh api` with REST routes instead, e.g. `gh api repos/vandean25/auto-core-platform/pulls/<n>` (read) and `gh api -X POST repos/vandean25/auto-core-platform/pulls -f title=... -f head=<branch> -f base=main -f body=...` (create).

### PR body (checked by CI)
- `gh pr create --body` / `gh api ... -f body=...` do **not** apply `.github/pull_request_template.md`. Write the body from the template yourself and keep every section (Summary, Screenshots, Risk, Issue, Tests).
- `Risk: low|medium|high|critical` is required on every PR and must be at least the path-derived minimum (G5, `.github/scripts/risk-from-paths.mjs`). The template default `Risk: low` fails when critical paths are touched.
- UI PRs (`apps/core-web/src/**/*.tsx`, excluding tests) need `Screenshots: Playwright attachments – <attachment names>` or `Screenshots: n/a – <reason>`.
- UI evidence: every UI-relevant WHEN/THEN scenario gets a Playwright test that ends in the THEN state and attaches a named screenshot (`await testInfo.attach('<stable-name>', { body: await page.screenshot(), contentType: 'image/png' })`); the DoD table names test + attachment. CI uploads the report (`playwright-report-*`) on every run and the reviewer opens the attachments from there. Do not download CI artifacts, commit screenshots (e.g. `docs/internal/assets/*.png`) or paste image links as evidence.
- Check before opening the PR:
  ```bash
  BASE_REF=main PR_BODY="$(cat pr-body.md)" node .github/scripts/risk-from-paths.mjs
  BASE_REF=main PR_BODY="$(cat pr-body.md)" node .github/scripts/ui-screenshots-check.mjs
  ```
- If CI reports a missing or too low Risk line or missing screenshots, fix the body (`gh pr edit <n> --body-file pr-body.md`) and push a new commit (an empty one is fine) so CI reruns.

### PR Lifecycle & CI Verification
- When opening a pull request for a Linear issue, create it initially as a **Draft PR** (`gh pr create --draft ...`).
- UI ticket acceptance criterion: **Every new record action is a registry action and reachable via Cmd+K.**
- PR checklist: frontend PRs tick the interaction-compliance item of the UI review checklist (`.agents/skills/acp-ui-polish/SKILL.md`, section 8), which points to [Frontend interaction rules](#frontend-interaction-rules).
- Monitor/verify that all continuous integration checks (linting, tests, build) pass.
- Once and only when all CI checks succeed, mark the pull request as ready for review:
  ```bash
  gh pr ready <PR_NUMBER>
  ```
- **Cursor Cloud Agents — subscribe until merge:** subscribe to CI and PR comments as described in `.cursor/rules/pr-lifecycle.mdc` and keep both subscriptions until the PR merges or closes.

### Local checks before pushing (CI is the source of truth)
- Locally, run only the checks for the workspace you touched: lint, typecheck/build, the unit tests of the files you changed, and only the Playwright/E2E spec files you added or changed.
- The full frontend UI smoke suite, the fullstack e2e suite and the backend E2E suite run **only in CI** (`.github/workflows/build.yaml`, sharded). The CI result is the source of truth; do not re-run full suites locally before pushing. If a prompt still requires the full backend E2E suite before push, use `npm run test:e2e:agent` (CI-parity runner), not bare `npm run test:e2e`.
- At most one local e2e attempt per change. No repeated full runs, no polling. If it fails for environment reasons (browser, ports, DB), push and let CI decide.
- Never create or commit temporary Playwright configs. If the installed Chromium does not match `@playwright/test`, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium; both Playwright configs honor it (the Claude Code SessionStart hook in `.claude/` sets it automatically when the browser download fails).

### Backend checks before pushing
For `core-api` changes, run before pushing:
```bash
npm exec --workspace=core-api -- prisma generate
npm run lint:prisma-tenant --workspace=core-api
npm run lint --workspace=core-api
npm run build --workspace=core-api
npm test --workspace=core-api -- --ci --runInBand --findRelatedTests <changed src/spec files>
```
Only if you added or changed a backend `.e2e-spec.ts`, run that one file once, against a fresh, unseeded `auto_core_test` database, migrated first and run serially (Cursor Cloud: see `.cursor/rules/cursor-cloud.mdc`):
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm exec --workspace=core-api -- prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm run test:e2e --workspace=core-api -- --ci --runInBand test/<your>.e2e-spec.ts
```
The full backend E2E suite runs only in CI.

### Frontend checks before pushing
For `core-web` changes, run before pushing:
```bash
npm run lint --workspace=core-web
npm run build --workspace=core-web
npm test --workspace=core-web -- <changed files or folders>
npm run api:types:check --workspace=core-web   # only when backend API contracts change
```
Only if you added or changed a Playwright spec, run just those files once (needs a matching Chromium, see above):
```bash
npm run test:e2e --workspace=core-web -- e2e/<your>.spec.ts
```
The full UI smoke suite (`npm run test:e2e` without a file filter) and `test:e2e:fullstack` run only in CI. The API types check goes alongside the generated OpenAPI artifacts described above.

### Code health gate (Fallow)
- The CI check `Code Health (Fallow)` (`fallow audit`, config `.fallowrc.json`) fails only on findings the PR introduces. Its CI result is the only source of truth.
- Run `npx fallow audit` at most once locally before pushing. No polling, no re-runs in a loop.
- At most one gate-fix round per PR. If it still fails, stop and flag it for a human in the PR; only an allowlisted human login (repo variable `GATE_OVERRIDE_ACTORS`) may add `gate-override` on the current head. CI re-runs on that label; no manual job re-run is required.
- Fix the code. Never game the gate with renames, file splits, stubs, re-export shims or suppression comments, and never edit `.fallowrc.json` or the workflow to pass.
- Reviewers do not repeat gate findings; they only check whether a gate fix is real or cosmetic. Details: `.agents/skills/acp-code-health/SKILL.md`.

## Entity Deletion Policy
- Source of truth: `docs/deletion-policy.md`
- Apply policy before adding any new delete endpoint or UI delete action.
- Backend must enforce all deletion rules; frontend should only mirror policy for UX, never replace backend validation.
- **Maintenance**: The AI MUST automatically propose updates to `docs/deletion-policy.md` whenever a new database entity is created or when business rules regarding the lifecycle of an existing entity are altered.

## Database Performance
🔴 **DON'T:** Never execute an `await` database query (read or write) inside a loop (N+1 anti-pattern).
🟢 **DO:** For reads, use the "Pre-fetch & Map" pattern with `in:` queries. For writes, map the data to an array of Prisma queries and resolve them concurrently using our global chunking utility `chunkedPromiseAll` inside a transaction.

## MCP Servers & Skills
- **context7** (`.cursor/mcp.json`; optional `CONTEXT7_API_KEY` in the agent environment, never commit keys): when you are unsure about a third-party library API (e.g. Prisma, NestJS, React, Playwright), look it up via Context7 for the version pinned in the relevant `package.json` before writing code — on demand, not on every task.

### Skill trees
Canonical skills live in `.agents/skills/` (Superpowers at `.agents/skills/superpowers/`). Codex and Cursor consume that tree — do not add `.codex/skills/` or `.cursor/skills/` copies.

### Local Project Skills

- **Mintlify Docs Skill**: `.agents/skills/mintlify-docs/SKILL.md`
  - Use it before writing or editing public Mintlify pages (`*.mdx`, `docs.json`). Enforces ACP workshop voice and the unique Mintlify design.
- **Tracing Request IDs Skill**: `.agents/skills/tracing-request-ids/SKILL.md`
  - Use it when debugging from a request id, `x-request-id`, Sentry Error ID, or Cloud Logging `http_error` line.
- **ACP i18n Skill**: `.agents/skills/acp-i18n/SKILL.md`
  - Use it before adding or changing user-facing text, editing `locales/{de,en}/*.json`, or when `npm run i18n:check` or `i18next/no-literal-string` fails. German (de-AT) is the source of truth.
- **ACP UI Polish Skill**: `.agents/skills/acp-ui-polish/SKILL.md`
  - Use it when building or changing UI in `apps/core-web` (pages, components, tables, forms, layout, styling, tokens, states, a11y), when reviewing UI PRs, or when the user mentions UI polish, design system, shadcn or Tailwind.
- **ACP Global Search Skill**: `.agents/skills/acp-global-search/SKILL.md`
  - Use it before adding or changing a global search (Cmd+K) entity type, search provider, `pg_trgm` index, or frontend search registry entry.

### Default working mode: Ponytail
- Every coding task runs in ponytail mode (level `full`) by default: read and follow `.agents/skills/ponytail/SKILL.md`. Reviewers use `ponytail-review`.
- Ponytail never overrides correctness, tests, the ACP i18n skill, the Fallow code-health rule, ADRs, or the pilot-customer naming rule (never name the customer).
- Sub-skills in `.agents/skills/`:
  - `ponytail-review`: quality review of a change (logic, safety, load, tests, speed, every line needed); reads the connected code, not only the diff.
  - `ponytail-audit`: one-shot quality audit of the whole repo, ranked findings; changes nothing.
  - `ponytail-debt`: lists every `shortcut:` (and older `ponytail:`) comment as a debt ledger; changes nothing.

## Google Secret Manager (Shared Dev Secrets)
Google Secret Manager (GSM, project `auto-core-platform-vande`) is the source of truth for local dev credentials. Copy `secrets/gsm-mapping.example.json` to the gitignored `secrets/gsm-mapping.json`, then pull with `npm --prefix apps/core-api run secrets:pull` (writes `apps/core-api/.env`) and `npm --prefix apps/core-web run secrets:pull` (writes `apps/core-web/.env.local`). Full guide: `docs/google-secret-manager.md`. Never commit real secret values or generated local `.env` files.

## Parallel local worktrees (optional)

Cloud agents ignore this section. On one machine you can run several coding agents in parallel, each in its own git worktree, with isolated API/Vite ports, env files, and Postgres databases. Use the root scripts `npm run worktree:new`, `worktree:setup`, and `worktree:remove`, plus `docker compose -f docker-compose.worktrees.yml up -d` for shared local Postgres. Full steps: [docs/local-multi-worktree-development.md](docs/local-multi-worktree-development.md).

**Local agents** whose tool creates the worktree itself (e.g. Codex, Qoder): if you are in a **linked** git worktree (not the primary checkout) and `apps/core-api/.env` is missing, run `npm run worktree:setup` before building, testing, or starting the app. **Cloud agents** (Cursor Cloud Agent runs, `NODE_ENV=test`, no local Docker) must **not** run worktree setup — skip this entirely.

## Cursor Cloud Agents
Cursor Cloud Agents follow `.cursor/rules/cursor-cloud.mdc` (environment, databases, reset commands, full-suite runner) and `.cursor/rules/pr-lifecycle.mdc` (CI and PR subscriptions).
