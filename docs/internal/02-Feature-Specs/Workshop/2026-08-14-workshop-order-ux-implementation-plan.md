# Workshop Order Details UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the advisor workshop order details page as one job document: identity header, accordion tasks with inline parts/labor, and a sticky checkout footer.

**Architecture:** Frontend-only. Extract `TaskLineItemEditor` from `TaskDetailDrawer`, replace the drawer and `isCheckoutView` page-swap in `WorkshopOrderDetails`, keep existing mutations and `useWorkshopCalculations`. No API or schema changes.

**Tech Stack:** React 19, Vite, Vitest, Testing Library, Tailwind v4, shadcn/ui, TanStack Query.

**Work from:** `c:\Git\auto-core-platform\.worktrees\workshop-order-ux-redesign`

**Spec:** `docs/internal/02-Feature-Specs/Workshop/2026-08-14-workshop-order-ux-design.md`

---

## File map

- Modify: `apps/core-web/src/pages/workshop/components/OrderHeader.tsx` — identity + ops header; drop KPI tiles and Waiter badge
- Modify: `apps/core-web/src/pages/workshop/components/TaskList.tsx` — accordion; no Open button; expanded editor + notes
- Create: `apps/core-web/src/components/workshop/TaskLineItemEditor.tsx` — labor/parts editor extracted from the drawer
- Modify: `apps/core-web/src/components/workshop/TaskDetailDrawer.test.tsx` → move/rename coverage onto `TaskLineItemEditor`
- Delete: `apps/core-web/src/components/workshop/TaskDetailDrawer.tsx` after extraction (only consumer is WorkshopOrderDetails)
- Modify: `apps/core-web/src/pages/workshop/components/CheckoutSummary.tsx` — drop Return to Tasks; `onReopenTask` closes footer + expands accordion
- Create: `apps/core-web/src/pages/workshop/components/CheckoutFooter.tsx` — sticky grand total + expand/collapse sheet
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.tsx` — always show tasks + cards; footer instead of checkout mode; remove docked drawer / matchMedia 1536px
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.test.tsx`
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.line-items.test.tsx`
- Include spec in the PR commit

---

### Task 1: Header identity + ops

**Files:**
- Modify: `apps/core-web/src/pages/workshop/components/OrderHeader.tsx`
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.tsx` (narrower `OrderTopBar` props)
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.test.tsx`

- [ ] **Step 1: Write failing tests** in `WorkshopOrderDetails.test.tsx`

Add under `standard view rendering`:

```ts
it('shows customer, vehicle, and plate in the header', () => {
  renderComponent()
  expect(screen.getByRole('heading', { name: 'WO-001' })).toBeInTheDocument()
  expect(screen.getByText(/John Doe/)).toBeInTheDocument()
  expect(screen.getByText(/2020 Toyota Corolla/)).toBeInTheDocument()
  expect(screen.getByText(/ABC-123/)).toBeInTheDocument()
})

it('shows promised time as Not set and does not render Waiter or KPI labels', () => {
  renderComponent()
  expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
  expect(screen.queryByText('Waiter')).not.toBeInTheDocument()
  expect(screen.queryByText('Total Parts')).not.toBeInTheDocument()
  expect(screen.queryByText('Labor Revenue')).not.toBeInTheDocument()
  expect(screen.queryByText('Internal Labor Cost')).not.toBeInTheDocument()
  expect(screen.queryByText('Est. Margin')).not.toBeInTheDocument()
})

it('puts Print Job Card in the header and Checkout in the footer, not Generate Invoice in the header', () => {
  renderComponent()
  expect(screen.getByRole('button', { name: /Print Job Card/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Generate Invoice/i })).not.toBeInTheDocument()
})
```

Remove or rewrite `registers media query listener for docked layout` — docked drawer is gone.

- [ ] **Step 2: Run tests to verify they fail**

```
npm --prefix apps/core-web test -- src/pages/workshop/WorkshopOrderDetails.test.tsx
```

Expected: FAIL on Waiter still present and/or Generate Invoice still in header.

- [ ] **Step 3: Implement `OrderTopBar`**

New props (drop finance totals):

```ts
export interface OrderTopBarProps {
  order: WorkshopOrder
  assignedTechName?: string | null
  bayName?: string | null
  onPrint: () => void
}
```

Render: order number + `StatusBadge`; subtitle `customer · vehicle · plate`; ops line `Promised time: Not set`, tech (Unassigned if missing), bay (Unassigned if missing); Print Job Card top-right. No Waiter badge. No KPI tiles. No invoice button.

Keep `CustomerVehicleInfo` cards unchanged, including duplicated promised/tech/bay.

Pass tech/bay names from `WorkshopOrderDetails` the same way as today (`useWorkshopResources`).

- [ ] **Step 4: Re-run tests — expect PASS for the new header cases.** Existing tests that still look for `Generate Invoice` will fail until Task 3; leave those failing tests to update in Task 3, OR temporarily keep a hidden invoice control only if tests require it — do **not** keep a header invoice button. Update Generate Invoice / Open Checkout clicks in the characterization file as part of Task 3. For Task 1, only add the new tests and make header match spec; if old tests fail because Generate Invoice vanished, update those old tests in Task 3 in the same working tree before finishing (do not leave the suite red).

- [ ] **Step 5: Commit**

```
git add apps/core-web/src/pages/workshop/components/OrderHeader.tsx apps/core-web/src/pages/workshop/WorkshopOrderDetails.tsx apps/core-web/src/pages/workshop/WorkshopOrderDetails.test.tsx
git commit -m "feat(workshop): replace order header KPIs with job identity"
```

---

### Task 2: Extract `TaskLineItemEditor` and accordion tasks

**Files:**
- Create: `apps/core-web/src/components/workshop/TaskLineItemEditor.tsx`
- Modify: `apps/core-web/src/pages/workshop/components/TaskList.tsx`
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.tsx`
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.line-items.test.tsx`
- Modify/rename: `apps/core-web/src/components/workshop/TaskDetailDrawer.test.tsx`
- Delete: `apps/core-web/src/components/workshop/TaskDetailDrawer.tsx`

- [ ] **Step 1: Failing tests**

In `WorkshopOrderDetails.test.tsx` (use `multiTaskOrder`):

```ts
it('expands a task in place and keeps only one task expanded', async () => {
  setupDefaultMocks(multiTaskOrder)
  renderComponent()
  fireEvent.click(screen.getByText('Oil Change'))
  expect(await screen.findByLabelText(/mechanic notes/i)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Brake Inspection'))
  expect(screen.getByText('Brake Inspection')).toBeInTheDocument()
})

it('does not render an Open button on task rows', () => {
  renderComponent()
  expect(screen.queryByRole('button', { name: /^Open$/i })).not.toBeInTheDocument()
})
```

Rewrite line-items test: remove `vi.mock` of `TaskDetailDrawer`. Expand the Oil Change row, then trigger the same save path the editor uses (or a testid on the editor). Persist via `replaceTaskLineItems.mutateAsync` with the same payload as today.

Move `TaskDetailDrawer.test.tsx` labor-metadata cases onto `TaskLineItemEditor`.

- [ ] **Step 2: Run tests — expect FAIL** (Open button still exists / drawer mock).

- [ ] **Step 3: Implement**

Move the labor/parts table + catalog/labor search from `TaskDetailDrawer` into `TaskLineItemEditor` with props:

```ts
{
  workshopOrderId: string
  taskId: string
  lineItems: TaskLineItem[]
  readOnly: boolean
  onLineItemsChange: (items: TaskLineItem[]) => void
}
```

`TaskList` accordion:
- `expandedTaskId: string | null` + `onExpandedTaskIdChange`
- Click row toggles/expands; checkbox `stopPropagation`
- Collapsed: title, status, `Parts €x · Labor €y · Std Nh · Actual Nh`, total
- Expanded: `TaskLineItemEditor` + `InlineEdit` mechanic notes + Delete
- Creating a task still sets expanded id to the new task (existing `setActiveTaskId` after create)

`WorkshopOrderDetails`: remove `TaskDetailDrawer`, `isDockedLayout`, matchMedia 1536px. Keep `handleTaskLineItemsChange` sequence/rollback.

Delete drawer file when unused.

- [ ] **Step 4: Run**

```
npm --prefix apps/core-web test -- src/pages/workshop/WorkshopOrderDetails.test.tsx src/pages/workshop/WorkshopOrderDetails.line-items.test.tsx src/components/workshop/TaskLineItemEditor.test.tsx src/components/workshop/TaskDetailDrawer.test.tsx
```

Expected: PASS (drawer test file may be deleted).

- [ ] **Step 5: Commit**

```
git commit -m "feat(workshop): edit task parts and labor in an accordion"
```

---

### Task 3: Sticky checkout footer

**Files:**
- Create: `apps/core-web/src/pages/workshop/components/CheckoutFooter.tsx`
- Modify: `apps/core-web/src/pages/workshop/components/CheckoutSummary.tsx`
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.tsx`
- Modify: `apps/core-web/src/pages/workshop/WorkshopOrderDetails.test.tsx`

- [ ] **Step 1: Failing tests**

```ts
it('shows grand total in the footer while IN_PROGRESS', () => {
  renderComponent()
  expect(screen.getByText('Grand total')).toBeInTheDocument()
  expect(screen.getAllByText('€55.00').length).toBeGreaterThan(0)
})

it('keeps the task list mounted when checkout expands', () => {
  setupDefaultMocks(completedOrder)
  renderComponent()
  expect(screen.getByText('Oil Change')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
  expect(screen.getByText('Oil Change')).toBeInTheDocument()
  expect(screen.getByText('Draft Invoice')).toBeInTheDocument()
})

it('does not show Return to Tasks', () => {
  setupDefaultMocks(completedOrder)
  renderComponent()
  fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
  expect(screen.queryByText('Return to Tasks')).not.toBeInTheDocument()
})

it('disables Create Draft Invoice until the order is COMPLETED', () => {
  renderComponent()
  fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
  expect(screen.queryByRole('button', { name: /Create Draft Invoice/i })).not.toBeInTheDocument()
})
```

Rewrite every `getAllByText('Generate Invoice')` / `'Open Checkout'` to click footer `Checkout` or `Open Invoice`.

INVOICED: footer shows `Open Invoice` (can keep navigating to invoice as today’s `handleCheckoutAction` did for invoiced — if today it toggled checkout view, instead expand footer or `navigate` to the invoice route if that already exists; **do not invent a new invoice page**. If current handler only opened checkout view, expand the locked checkout sheet and keep Open Invoice as the collapsed-bar label).

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Replace `isCheckoutView` with `isCheckoutOpen` boolean. Body (cards + tasks) **always** renders.

`CheckoutFooter`: sticky bottom bar, `Grand total` + `formatCurrency(orderGrandTotal)` (or invoice gross when linked invoice loaded — match `useWorkshopCalculations` / existing totals). Button: `Checkout` or `Open Invoice` when `isInvoicedWithLinkedInvoice`. Expanding shows `CheckoutSummary`. Close collapses.

`CheckoutSummary`: remove Return to Tasks. `onReopenTask(taskId)`: parent sets `isCheckoutOpen=false` and `expandedTaskId=taskId`.

Draft/issue gates unchanged (`canCreateDraftInCheckout` / `canIssueInvoiceInCheckout`) but they must not depend on a page-swap flag that hides tasks. Compute them from order/invoice status only (drop `isCheckoutView &&` from the gate, or keep it as `isCheckoutOpen &&` so buttons only show when expanded — either is fine as long as IN_PROGRESS cannot issue).

- [ ] **Step 4: Run workshop details tests — PASS**

- [ ] **Step 5: Commit**

```
git commit -m "feat(workshop): keep checkout in a sticky footer on the job"
```

---

### Task 4: Verify build and remaining tests

- [ ] **Step 1: Run**

```
npm --prefix apps/core-web test -- src/pages/workshop src/components/workshop
npm --prefix apps/core-web run build
```

Expected: all targeted tests PASS; `tsc -b && vite build` succeeds.

- [ ] **Step 2: Commit spec + plan if not already committed**

```
git add docs/internal/02-Feature-Specs/Workshop/2026-08-14-workshop-order-ux-design.md docs/internal/02-Feature-Specs/Workshop/2026-08-14-workshop-order-ux-implementation-plan.md
git commit -m "docs(workshop): add workshop order UX redesign spec"
```

- [ ] **Step 3: Self-review against spec** — header identity, no Waiter, accordion, no drawer, footer total, no page swap, cards kept, no API changes.

---

## Constraints

- TDD: failing test before production code for each behavior.
- `import type` for type-only imports.
- `StatusBadge` for statuses.
- Do not change backend, OpenAPI, board, pick list, intake, or mechanic tablet.
- Do not add promised_time / key_tag schema fields.
- Do not rebuild labor margin KPIs.
- Follow existing toast + mutation patterns.
- Work only in the worktree path above. Commit on `feat/workshop-order-ux-redesign`. Do not push unless asked. Do not merge.
