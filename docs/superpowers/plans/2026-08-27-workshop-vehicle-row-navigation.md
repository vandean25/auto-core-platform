# Workshop and Vehicle Row Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Workshop Orders, Vehicles, and Vehicle Stock data rows reliably clickable while preserving keyboard and context-menu interactions.

**Architecture:** Keep navigation ownership in the three existing list pages and make the shared `DataTable` the single owner of row activation. Because table-row click bubbling is unreliable for real WebKit cell taps, the shared component will attach activation to each data cell, ignore clicks from interactive descendants, and retain row-level keyboard/context-menu behavior. Regression tests will cover shared event behavior and all three browser routes.

**Tech Stack:** React 19, TypeScript, TanStack React Table legacy adapter, Vitest, React Testing Library, Playwright.

---

## Files and Responsibilities

- Modify `apps/core-web/src/components/data-table/DataTable.tsx` to centralize safe per-cell pointer activation for clickable rows.
- Modify `apps/core-web/src/components/data-table/DataTable.test.tsx` with failing-first unit coverage for ordinary clicks and interactive descendants.
- Modify `apps/core-web/src/pages/mechanic/MechanicQueuePage.test.tsx` so the existing shared-table navigation regression clicks a real task cell.
- Modify `apps/core-web/src/components/hr/EmployeeTable.test.tsx` so existing employee-sheet tests click a real employee cell.
- Create `apps/core-web/e2e/workshop-orders.spec.ts` to cover Workshop Orders row navigation using the existing mock factories and POM.
- Verify existing `apps/core-web/e2e/vehicles.spec.ts` and `apps/core-web/e2e/vehicle-stock.spec.ts` continue to cover their row destinations, including received stock and draft purchases.

### Task 1: Add the failing shared-row interaction test

**Files:**

- Modify: `apps/core-web/src/components/data-table/DataTable.test.tsx`

- [ ] **Step 1: Add a pointer-click test for ordinary row content and interactive descendants**

Add this test inside the existing `describe('DataTable Characterization', ...)` block:

```tsx
  it('activates ordinary row clicks but leaves interactive descendants in control', () => {
    const onRowClick = vi.fn()
    const columnsWithAction = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: () => <button type='button'>Edit</button>,
      },
    ]

    render(
      <DataTable
        {...defaultProps}
        columns={columnsWithAction}
        onRowClick={onRowClick}
      />,
    )

    const row = screen.getByRole('row')
    fireEvent.click(row)
    expect(onRowClick).toHaveBeenCalledWith({ name: 'Test Item' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npm run test --workspace=core-web -- src/components/data-table/DataTable.test.tsx
```

Expected result: the new test fails because the current row-level `onClick` also receives clicks originating from the nested `Edit` button, while the ordinary row-click assertion passes.

### Task 2: Implement safe shared row activation

**Files:**

- Modify: `apps/core-web/src/components/data-table/DataTable.tsx`

- [ ] **Step 1: Add a single row-click handler that filters interactive targets**

Add this helper beside `isInteractiveTarget`:

```tsx
function activateRow<TData extends object>(
  event: React.MouseEvent | React.KeyboardEvent,
  row: TData,
  onRowClick?: (row: TData) => void,
) {
  if (!onRowClick || isInteractiveTarget(event.target)) return
  onRowClick(row)
}
```

Remove the row-level pointer handler and update the rendered data cells from:

```tsx
<TableCell key={cell.id}>
  {flexRender(cell.column.columnDef.cell, cell.getContext())}
</TableCell>
```

to:

```tsx
<TableCell
  key={cell.id}
  className={onRowClick ? 'cursor-pointer' : undefined}
  onClick={(event) => activateRow(event, row.original as TData, onRowClick)}
>
  {flexRender(cell.column.columnDef.cell, cell.getContext())}
</TableCell>
```

Update the existing keyboard activation to call `activateRow(event, row.original as TData, onRowClick)`. Keep the context-menu handler unchanged so row actions retain their current behavior.

- [ ] **Step 2: Run the focused unit test and confirm it passes**

Run:

```powershell
npm run test --workspace=core-web -- src/components/data-table/DataTable.test.tsx
```

Expected result: all `DataTable.test.tsx` tests pass, including the new ordinary-click and interactive-descendant assertions.

- [ ] **Step 3: Refactor only after green**

Review the helper name and argument order for clarity, remove any unnecessary duplication, and rerun the same focused test. Do not change the existing context-menu or keyboard semantics.

### Task 3: Add Workshop Orders browser regression coverage

**Files:**

- Create: `apps/core-web/e2e/workshop-orders.spec.ts`

- [ ] **Step 1: Add a mocked list-page navigation test**

Create the test with this structure:

```ts
import { test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'

test.describe('Workshop Orders list', () => {
  test('opens the workshop order detail when a row is clicked', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: 'workshop-order-click-1',
      order_number: 'WO-2026-0221',
      vehicle: { id: 'vehicle-click-1', make: 'Toyota', model: 'Corolla', year: 2021, plate: 'W-221AC' },
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([order])),
      })
    })

    await corePage.navigate('/workshop/orders')
    await corePage.openRowDetails('WO-2026-0221')
    await page.waitForURL(`/workshop/orders/${order.id}`)
  })
})
```

- [ ] **Step 2: Run the focused browser regressions**

Run:

```powershell
npm run test:e2e --workspace=core-web -- e2e/workshop-orders.spec.ts e2e/vehicles.spec.ts e2e/vehicle-stock.spec.ts
```

Expected result: Workshop Orders, Vehicles, and Vehicle Stock row navigation passes; Vehicle Stock continues to route received stock to `/vehicle-stock/:id` and draft purchases to `/vehicle-stock/purchases/:id`, and its context-menu Delete test remains green.

### Task 4: Verify the complete frontend change

**Files:**

- Verify: `apps/core-web/src/components/data-table/DataTable.tsx`
- Verify: `apps/core-web/src/components/data-table/DataTable.test.tsx`
- Verify: `apps/core-web/src/components/hr/EmployeeTable.test.tsx`
- Verify: `apps/core-web/src/pages/mechanic/MechanicQueuePage.test.tsx`
- Verify: `apps/core-web/e2e/workshop-orders.spec.ts`
- Verify: `apps/core-web/e2e/vehicles.spec.ts`
- Verify: `apps/core-web/e2e/vehicle-stock.spec.ts`

- [ ] **Step 1: Run frontend unit tests**

```powershell
npm test --workspace=core-web
```

Expected result: Vitest exits with code 0 and reports zero failed tests.

- [ ] **Step 2: Run frontend lint and build**

```powershell
npm run lint --workspace=core-web
npm run build --workspace=core-web
```

Expected result: both commands exit with code 0.

- [ ] **Step 3: Run the full frontend e2e suite**

```powershell
npm run test:e2e --workspace=core-web
```

Expected result: Playwright exits with code 0 and reports zero failed tests.

- [ ] **Step 4: Inspect the final diff and commit the implementation**

```powershell
git diff --check
git diff --stat
git add apps/core-web/src/components/data-table/DataTable.tsx apps/core-web/src/components/data-table/DataTable.test.tsx apps/core-web/src/components/hr/EmployeeTable.test.tsx apps/core-web/src/pages/mechanic/MechanicQueuePage.test.tsx apps/core-web/e2e/workshop-orders.spec.ts
git commit -m "fix(web): make workshop and vehicle rows clickable"
```

Expected result: the commit contains only the shared row interaction fix and its regression coverage.
