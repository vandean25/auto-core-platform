# Auto Core Platform — E2E Testing Guide

## Overview

The E2E suite is structured as a **Blueprint-Based Framework** that enforces the "Golden Rules"
of our UI/UX design system.  Tests don't just check feature functionality — they verify that every
module follows the same architectural patterns.

---

## Running Tests

```bash
# From apps/core-web directory
npm run test:e2e          # Run all E2E tests (headless)
npx playwright test --ui  # Interactive UI mode
E2E_LIVE_BACKEND=true npm run test:e2e  # Include seed-based smoke tests against a live seeded backend
```

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
name exactly matches the `entityName` (optionally with a leading `+ `). The page button must
follow the design-system convention:

```tsx
// ✅ Correct — accessible name is exactly "Vendor" or "+ Vendor" (icon is decorative)
<Button onClick={...}><Plus className="mr-2 h-4 w-4" /> Vendor</Button>

// ✅ Also correct for Link-as-Button pattern — exact label matches
// "Purchase Order" or "+ Purchase Order"
<Button asChild><Link to="/new"><Plus /> Purchase Order</Link></Button>

// ❌ Wrong — do not use "Add", "New", or "Create" in the label
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
