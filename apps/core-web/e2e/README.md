# Auto Core Platform — E2E Testing Guide

## Overview

The E2E suite is structured as a **Blueprint-Based Framework** that enforces the "Golden Rules"
of our UI/UX design system.  Tests don't just check feature functionality — they verify that every
module follows the same architectural patterns.

---

## Running Tests

```bash
# From apps/core-web directory
npm run test:e2e          # Build the E2E bundle, then run all E2E tests (headless)
npm run test:e2e -- --shard=1/3  # Run one of three shards (CI runs them in parallel)
npx playwright test --ui  # Interactive UI mode (run `npm run build:e2e && npm run build:pwa` first)
E2E_LIVE_BACKEND=true npm run test:e2e  # Include seed-based smoke tests against a live seeded backend
UPDATE_DOC_SCREENSHOTS=1 npm run test:e2e -- e2e/<spec>.spec.ts  # Re-capture the screenshots under docs/internal/assets (skipped without the flag)
```

The suite runs against a production bundle built by `npm run build:e2e` (mode `e2e`, with
`VITE_E2E_SKIP_AUTH=true` baked in) and served by `vite preview` on port 5174, so first page loads do not
wait on on-demand module transforms. `npx playwright test` does not rebuild the bundle: run
`npm run build:e2e` first after changing app code (`npm run test:e2e` does this for you).

`pwa-shell.spec.ts` needs the real production build (the service worker is not registered in the e2e bundle):
`npm run build:pwa` writes `dist-pwa`, served on port 5176 for the `chromium-pwa` project. `npm run test:e2e`
builds both bundles; `npx playwright test` needs `dist-e2e` and `dist-pwa` to exist.

The other exception is `login.spec.ts`. It rewrites dev-server module URLs (`/src/lib/runtime-flags.ts`) to show
the sign-in form, so it runs in the `chromium-dev-server` project against the Vite dev server on port 5175.

---

## Visual regression (AUT-657, advisory)

`e2e/visual/*.visual.spec.ts` compare the core pages (login, dashboard, customer list and detail, workshop order,
vehicle, inventory, settings) and the sidebar (expanded, collapsed, mobile sheet) with committed screenshots in
`e2e/visual/__screenshots__/`. They run in their own Playwright project, `visual`: `npm run test:e2e` selects only the
three smoke projects, so the smoke shards never see them.

```bash
npm run test:visual          # compare with the baselines
npm run test:visual:update   # rewrite the baselines (only on purpose, see below)
```

- **Deterministic by setup:** 1440x900 (390x844 for the mobile sheet), `de-AT`, Europe/Vienna, reduced motion, fixed
  clock, fonts awaited, animations off, timestamps/avatars/version banner masked, unmocked API calls answer 404.
  Tolerance is `maxDiffPixelRatio` 0.01 (anti-aliasing noise only). A page can hide another volatile region from the
  comparison by marking it with the `data-visual-mask` attribute; the suite masks every element carrying it.
- **Baselines come from Linux Chromium in the CI image** (`mcr.microsoft.com/playwright:v1.65.0-noble`). A baseline
  written on macOS or Windows differs in text rendering and fails in CI. On a laptop run the update inside that image:
  `docker run --rm --ipc=host -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.65.0-noble npm run test:visual:update --workspace=core-web`.
- **Update baselines only deliberately.** A diff you did not intend is a bug: fix the page. When the change is intended,
  run `test:visual:update`, look at every changed PNG, and put the before/after screenshot in the PR description.
- **CI:** the advisory job `UI Visual Regression (advisory)` (`.github/workflows/ui-visual.yaml`) runs on changes under
  `apps/core-web/**`, `locales/**`, or the root `package.json` / `package-lock.json` / `.nvmrc` (the inputs `npm ci`
  installs the UI dependency tree from). It never blocks a merge. On a diff it uploads expected, actual and diff images as
  the `ui-visual-diff` artifact and links it in the job summary.

---

## Test Suites

| File | Lane | Purpose |
|---|---|---|
| `core-workflows.spec.ts` | Blueprint | Golden Rules validation for every list page (mocked) |
| `inventory.spec.ts` | Smoke + Blueprint | Seed-based smoke tests + mocked boundary tests |
| `auto-save.spec.ts` | Blueprint | Debounced auto-save cycle verification (mocked) |
| `catalog-workflow.spec.ts` | Blueprint | Workshop catalog fitment filtering (mocked) |

### Two Test Lanes

**Blueprint Validation (mocked, deterministic)**
- All API calls are intercepted via `page.route`.
- Routes are always registered *before* navigation (`mock-first-then-navigate`).
- Do not depend on database seed state — run anywhere.

**Smoke Tests (seed-based)**
- Navigate against a fully seeded environment.
- Verify basic page load and known SKU/record visibility.
- Label with `Smoke Tests (seed-based)` in the `test.describe` name.
- Opt in with `E2E_LIVE_BACKEND=true`; they are skipped by default in frontend-only CI.

---

## Architecture

### Base POM — `pom/AutoCorePage.ts`

The mandatory base class for all list-page tests.  Encapsulates the three Golden Rules:

| Rule | Method |
|---|---|
| Header Structure (title left, actions right) | `verifyHeaderConsistency(title)` |
| Data-attribute rows (`data-table-row="true"`) | `openRowDetails(searchText)` |
| Row click opens detail or navigates | `openRowDetails(searchText)` |
| Debounced auto-save cycle | `waitForAutoSave(apiPath)` |

```ts
const corePage = new AutoCorePage(page, 'Vendor');
await corePage.navigate('/vendors');
await corePage.verifyHeaderConsistency('Vendors');
await corePage.openRowDetails('Bosch Automotive');
```

### Feature POMs — `pom/WorkshopPOM.ts`

Domain-specific extensions of `AutoCorePage`.  Add a new feature POM when a module needs
interactions beyond simple list → detail navigation (e.g., task drawers, catalog search).

### Mock Factories — `utils/mock-factories.ts`

Every entity has a typed factory function that returns an object matching the OpenAPI contract.
Use overrides to customise individual fields:

```ts
const item = createMockInventoryItem({ sku: 'CUSTOM-001', name: 'Custom Part' });
```

Use `createMockListResponse(items)` to wrap items in the standard `{ data, meta }` envelope:

```ts
await page.route(AutoCorePage.apiRouteMatcher('/api/vendors'), async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(createMockListResponse([createMockVendor()])),
  });
});
```

---

## Golden Rules Checklist for New Modules

When you add a new list page, your E2E test MUST:

- [ ] Extend `AutoCorePage` (or a feature POM that extends it).
- [ ] Register all API mocks **before** calling `corePage.navigate()`.
- [ ] Call `corePage.verifyHeaderConsistency(pageTitle)` to enforce header layout.
- [ ] Call `corePage.openRowDetails(seedText)` to verify row interaction.
- [ ] Use `createMockListResponse()` to wrap mock items.
- [ ] Add a factory to `mock-factories.ts` if the entity doesn't have one yet.
- [ ] Add a row to the `modules` array in `core-workflows.spec.ts`.

### Create Button Convention

The `AutoCorePage.createButton` locator matches any `<button>` or `<a>` element whose accessible
name exactly matches the `entityName` (optionally with a leading `+ `). For a `New <entity>` label,
pass the full label as `entityName`. The page button must follow the design-system convention:

```tsx
// ✅ Correct — accessible name is exactly "Vendor" or "+ Vendor" (icon is decorative)
<Button onClick={...}><Plus className="mr-2 h-4 w-4" /> Vendor</Button>

// ✅ Also correct for Link-as-Button pattern — exact label matches
// "Purchase Order" or "+ Purchase Order"
<Button asChild><Link to="/new"><Plus /> Purchase Order</Link></Button>

// ✅ Correct — sentence-case "New <entity>" label; pass the full label as entityName
// new AutoCorePage(page, 'New transfer')
<Button onClick={...}><Plus className="mr-2 h-4 w-4" /> New transfer</Button>

// ❌ Wrong — do not use "Add" or "Create" in the label
<Button>Add New Vendor</Button>
```

### Row Data Attributes

The shared `DataTable` component automatically sets `data-table-row="true"` on every `<tr>`.
Do not add raw `<tr>` rows without going through `DataTable` — the POM depends on this attribute.

For domain-specific rows outside `DataTable` (e.g., workshop task list), add the appropriate
attribute manually:

```tsx
// Workshop tasks
<div data-workshop-task-row="true" ...>
```

### Auto-Save Verification

For document-style forms (bills, invoices, orders) use the `waitForAutoSave` helper.
Call it as a *concurrent* promise: start listening for the response **before** filling the field
so the 750 ms debounce window gives enough time.

```ts
// ✅ Correct pattern
const autoSavePromise = corePage.waitForAutoSave('/api/purchase-invoices');
await input.fill('NEW-VALUE');
await autoSavePromise;

// ❌ Wrong — listener registered after debounce may miss the response
await input.fill('NEW-VALUE');
await corePage.waitForAutoSave('/api/purchase-invoices');
```

---

## Schema-First Rule

When the Prisma schema or OpenAPI contract changes:

1. Update `mock-factories.ts` to reflect new/changed fields.
2. Re-run `npm --prefix apps/core-web run api:types:generate` to refresh generated types.
3. Ensure all factory return types still match the API shape.

Mock drift (factories returning shapes the real API no longer returns) causes tests to pass
locally while hiding real UI bugs.
