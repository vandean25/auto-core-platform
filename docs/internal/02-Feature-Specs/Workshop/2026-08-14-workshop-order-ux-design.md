---
title: "Workshop Order Details UX Redesign"
date: "2026-08-14"
module: "Workshop"
status: draft
tags:
  - feature-spec
  - workshop
  - ux
---

# Workshop Order Details UX Redesign

## Summary

> Redesign the service-advisor desktop workshop order details page so it reads as one job document: identity in the header, context cards on the left, accordion tasks with parts and labor in the page, and a sticky checkout footer. Mechanic tablet and manager board stay out of this pass. No API or schema changes.

This replaces three current problems: a finance-KPI header that does not identify the job, a 1000px task drawer that splits the estimate from the task list, and a checkout mode that unmounts the job.

---

## User Stories

- As a **service advisor**, I want to **see customer, vehicle, plate, tech, bay, and status in the header** so that **I know which job I am on without scanning KPI tiles**.
- As a **service advisor**, I want to **add parts and labor inside the task row** so that **I can build an estimate without opening a side drawer**.
- As a **service advisor**, I want to **see the running total while I work, then expand checkout without leaving the job** so that **I can quote and invoice without losing repair context**.

---

## Locked Decisions

| Topic | Decision |
|-------|----------|
| Primary user | Service advisor on desktop. Mechanic tablet and manager board are follow-up surfaces. |
| Approach | Job document with the three existing context cards kept on the left (not a compact strip). |
| Header | Identity + ops: order number, status, customer, vehicle, plate, promised time, tech, bay. Print Job Card top-right. |
| Header duplication | Promised time, tech, and bay may also remain on the Order Info card. |
| Tasks | Accordion: one task expanded at a time. Collapsed rows show a parts/labor summary. |
| Task notes | Mechanic notes sit under the line-item table in the expanded row, not on a second tab. |
| Checkout | Sticky footer with running total. Expand in place for discounts and Issue Invoice. Tasks stay mounted. |
| Context cards | Keep Order Info, Customer Info, and Vehicle Info as they are. |
| APIs | No backend, schema, or OpenAPI changes. |

---

## Page Layout

Top to bottom on `/workshop/orders/:id`:

1. **Header** (`OrderTopBar`) — identity + ops + Print Job Card.
2. **Two-column body** (1/3 + 2/3, unchanged breakpoint):
   - Left: `CustomerVehicleInfo` (three cards).
   - Right: reported issue, accordion task list, order-level internal notes.
3. **Sticky footer** — grand total + Checkout. Expanding the footer does not unmount the body.

Remove:

- The five KPI tiles (parts, labor revenue, internal labor cost, est. margin, grand total) from the header.
- The hardcoded **Waiter** badge.
- `isCheckoutView` page swap that replaces the task list with `CheckoutSummary`.
- `TaskDetailDrawer` on this page, including the 1536px docked variant.

Grand total moves to the footer. Internal labor cost and estimated margin are **not** rebuilt on this page in this pass.

---

## Header

**Left**

- Order number as the page title (`text-2xl font-semibold tracking-tight`).
- `StatusBadge` for workshop order status.
- Subtitle line: customer name · vehicle year/make/model · plate.
- Ops line: promised time, assigned tech, bay.

**Right**

- Print Job Card only (existing PDF generate/download behavior).
- Invoice actions move to the footer. Do not keep Generate Invoice / Open Checkout in the header.

**Placeholder fields (explicit)**

`WorkshopOrder` has no `promised_time` or `key_tag` columns today. The current Order Info card already shows “Not set” for both.

- Header promised time: show the real value if a field is added later; **this pass shows “Not set”** and does not add a schema field.
- Key tag stays on the Order Info card as “Not set”. It is not promoted to the header.
- Tech and bay use existing `mechanic_id` / `bay_id` (name lookup via `useWorkshopResources`, same as today). Unassigned renders as “Unassigned”.

---

## Accordion Tasks

**Collapsed row**

- Title, status badge, parts/labor count, standard/actual hours, task total.
- No “Open” button. Clicking the row expands it.
- Checkbox/done toggle stays on the row and does not expand/collapse.

**Expanded row (one at a time)**

- Expanding a task collapses the previously open task.
- Line-item editor from today’s drawer: catalog search, labor search, qty, price, delete line, type PART/LABOR.
- Same `replaceTaskLineItems` save path and in-flight sequence handling as today.
- Mechanic notes under the table, save-on-blur via the existing task update mutation.
- Delete task control in the expanded row, same confirmation dialog and deletion policy as today.

**Around the list**

- “+ Task” input stays at the top of the list.
- Reported issue stays above the list (`InlineEdit`).
- Order-level internal notes stay in the card below the list.
- Voice-note recording is **out of scope** (mechanic tablet later).
- When the order is `INVOICED` (or a linked invoice exists), task delete and line edits stay locked as they are today.

Extract the labor/parts editor from `TaskDetailDrawer` into `TaskLineItemEditor` and use it inside the accordion. Retire drawer usage from `WorkshopOrderDetails`. Delete `TaskDetailDrawer` if nothing else imports it after the extract (today it is only used here).

---

## Sticky Checkout

**Collapsed bar (always visible)**

- Label: Grand total.
- Value: same `orderGrandTotal` used today (pre-invoice) or invoice gross once a linked invoice exists.
- Primary control: “Checkout” (expands the sheet) or “Open Invoice” when the order is invoiced with a linked invoice.

**Expanded sheet**

- Tasks remain mounted above. Close collapses the sheet; there is no “Return to tasks”.
- Reuse `CheckoutSummary` contents: grouped lines, line/task discounts, subtotal, discount, net, tax, gross, create draft, issue.
- Clicking a task group in checkout collapses the sheet and expands that accordion row so the advisor can edit lines.
- Create draft / issue stay gated exactly as today: draft only when status is `COMPLETED` and no invoice exists; issue only when a `DRAFT` invoice exists and the order is not locked.
- While the order is not ready to invoice, Checkout may still expand to show totals, but draft/issue actions stay disabled.
- After `INVOICED`, the bar stays with a locked total and Open Invoice; discount fields stay read-only.

---

## Database Impact

No new tables, columns, indexes, or migrations.

### Deletion Policy Impact

None. Task delete rules are unchanged (`docs/deletion-policy.md`).

---

## API Contract Changes

None. No OpenAPI regeneration.

Existing mutations stay:

- `PATCH` workshop order (reported issue, notes)
- Create / update / delete workshop task
- Replace task line items
- Create draft invoice / issue invoice / update invoice discount
- Generate / download workshop PDF

---

## UX Compliance

### Layout & Actions

- [x] Page-level Print stays **top-right**.
- [x] Top-left reserved for order number, status, identity subtitle.
- [x] Invoice primary action moves to the sticky footer (still a page-level action, pinned bottom-right of the footer bar).
- [x] `StatusBadge` for order and task status.
- [x] Multi-field header/order edits keep **debounced auto-save (750 ms)** where already used.
- [x] Single-field notes keep **save-on-blur** via `InlineEdit`.

### List Pages

Not in scope (order list, board, intake unchanged).

---

## Components

| Unit | Responsibility |
|------|----------------|
| `OrderTopBar` | Identity + ops header; Print Job Card |
| `CustomerVehicleInfo` | Three context cards (unchanged content) |
| `TaskList` | Reported issue, accordion list, add-task, internal notes |
| `TaskLineItemEditor` (extracted from `TaskDetailDrawer`) | PART/LABOR table + catalog/labor search |
| `CheckoutSummary` | Discount/issue UI inside the footer sheet |
| `WorkshopOrderDetails` | Data loading, mutations, accordion open id, footer open state |

`useWorkshopCalculations` stays the source of task totals and checkout figures.

---

## Error Handling

- Save failures keep toast errors with the existing `getErrorMessage` helper.
- Line-item save races keep the current sequence + rollback-to-previous-items behavior.
- Footer draft/issue buttons stay disabled while mutations are pending and when gates fail.
- PDF generate/download errors stay on the existing print handler.

---

## Testing

Update:

- `WorkshopOrderDetails.test.tsx` — characterization of header identity (no KPI tiles, no Waiter badge), accordion instead of drawer, footer total visible while `IN_PROGRESS`.
- `WorkshopOrderDetails.line-items.test.tsx` — drive line-item persistence through the accordion editor, not a mocked drawer.
- `TaskDetailDrawer.test.tsx` — retarget to the extracted editor (or keep covering the extracted module).

Add:

- Only one task expanded at a time.
- Expanding checkout does not unmount the task list.
- Footer Issue/draft disabled until current gates pass.
- Collapsed task row shows parts/labor count summary.

No new backend e2e. No OpenAPI fixture updates.

---

## Out of Scope

- Mechanic tablet digital job card / voice notes
- Workshop board, pick list, intake dialog, order list
- Promised-time and key-tag data model
- Rebuilding labor margin / internal cost KPIs
- Changing invoice, discount, or PDF backend behavior
- Folding context cards into a compact strip (rejected after seeing the layout)

---

## Success Criteria

The advisor can open a workshop order, identify the customer and vehicle in the header, build an estimate by expanding tasks in place, see the running total without leaving the page, and issue an invoice from the footer without the job being replaced by a checkout view.
