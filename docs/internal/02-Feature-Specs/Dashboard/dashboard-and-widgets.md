---
title: "Dashboard & Widgets"
date: "2026-04-12"
module: "Dashboard"
status: draft
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - dashboard
  - widgets
  - real-time
---

# Dashboard & Widgets

## Summary

> The Dashboard provides a configurable, widget-based overview of business activity across all modules. Users can assemble a personalized grid of widgets that display live data from Workshop Orders, Purchase Orders, Sales Orders, Inventory, Customers, Vendors, Vehicles, and Purchase Bills. Each widget supports three display modes — list preview (top 5 items), metric (count or sum), and donut chart (grouped by field) — and receives real-time updates via WebSocket events. The dashboard serves as the primary landing surface for daily operational awareness.

---

## User Stories

- As a **shop owner**, I want to **see a real-time overview of today's workshop orders, open purchase orders, and pending invoices** so that **I can monitor business activity at a glance**.
- As a **service advisor**, I want to **configure my dashboard with widgets relevant to my role** so that **I see workshop intake and customer data without clutter**.
- As a **parts manager**, I want to **add an inventory widget showing low-stock items** so that **I can proactively reorder**.
- As any **user**, I want **widgets to update in real-time** so that **I don't need to refresh the page to see new orders or status changes**.
- As any **user**, I want to **click a widget to navigate to the filtered source list** so that **I can drill down from overview to detail**.

---

## Database Impact

### New Tables / Columns

None. The Dashboard is a **read-only aggregation layer** — it does not introduce new database entities. Widget configuration is stored in the frontend (browser local storage or user preferences).

### Deletion Policy Impact

No new entities. The Dashboard consumes existing entities but does not own any.

---

## State Machine & Transitions

This module does not use status state machines. Widgets are stateless UI components that fetch and display data.

---

## API Contract Changes

### Endpoints

The Dashboard does **not** have dedicated backend API endpoints. It consumes the existing list endpoints from each module:

| Data Source | Endpoint Consumed | Fields Displayed |
|-------------|-------------------|-----------------|
| Workshop Orders | `GET /workshop` | `order_number`, `customer.last_name`, `vehicle.make`, `status` |
| Purchase Bills | `GET /purchase-invoices` | `vendor_invoice_number`, `vendor.name`, `status`, `total_amount` |
| Purchase Orders | `GET /purchase` | `order_number`, `vendor.name`, `status`, `items.length` |
| Sales Orders | `GET /sales-orders` | `order_number`, `customer.last_name`, `status`, `total_amount` |
| Inventory | `GET /inventory` | `sku`, `name`, `brand`, `status`, `price` |
| Customers | `GET /customers` | `type`, `last_name`, `email`, `address_city` |
| Vendors | `GET /vendors` | `name`, `email`, `account_number` |
| Vehicles | `GET /vehicles` | `make`, `model`, `plate`, `year` |

### WebSocket Events

The Dashboard subscribes to the `entity_updated` WebSocket event on the `/dashboard-realtime` namespace (ADR-0001):

```typescript
{
  type: DashboardEntityType,   // e.g., 'WORKSHOP_ORDER'
  action: DashboardEntityAction, // 'CREATED' | 'UPDATED' | 'DELETED'
  entityId?: string,
  timestamp: string            // ISO 8601
}
```

**Supported Entity Types:** `PURCHASE_ORDER`, `PURCHASE_INVOICE`, `WORKSHOP_ORDER`, `SALES_ORDER`, `CATALOG_ITEM`, `CUSTOMER`, `VENDOR`, `VEHICLE`.

When an `entity_updated` event is received, the frontend `RealtimeDashboardSyncProvider` invalidates the corresponding TanStack Query cache, causing affected widgets to re-fetch. The mapping from entity types to query keys is maintained in `src/features/realtime/dashboard-entity-map.ts`.

### OpenAPI Regeneration

Not applicable — Dashboard consumes existing endpoints only.

---

## UX Compliance

### Layout & Actions

- [x] Dashboard page route: `/dashboard`.
- [x] Responsive grid layout: 2 columns on medium screens, 3 columns on extra-large screens.
- [x] Widget management controls allow adding, removing, and configuring widgets.

### Widget Types

| Type | Display | Interaction |
|------|---------|-------------|
| **List** | Top 5 rows with configured preview fields. | Click widget → navigate to source list with filter applied. |
| **Metric** | Single number — count of items or sum of a currency field. | Click → navigate to source list. |
| **Donut** | Pie chart grouped by a field (e.g., status). | Click segment → navigate to source list filtered by that value. |

### Widget Card

- Each widget card shows the source label and widget name.
- Remove button (×) on each card.
- Loading and error states per widget.
- Currency values formatted with locale-appropriate formatting.

### Form Handling

- Widget configuration does **not** use auto-save — changes are applied immediately via state management.

### Real-Time Sync

- [x] The Dashboard is the **primary consumer** of the real-time sync infrastructure (ADR-0001).
- [x] `RealtimeDashboardSyncProvider` wraps the dashboard page.
- [x] Entity-to-query-key mapping in `dashboard-entity-map.ts` ensures targeted cache invalidation.
- [x] Widget data cache stale time: 5 minutes (re-fetch triggered earlier by WebSocket events).

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `DashboardPage` | `src/pages/` | Page shell for the widget grid. |
| `DashboardWidgetsGrid` | `src/features/dashboard-widgets/` | Responsive grid layout rendering all configured widgets. |
| `DashboardWidgetCard` | `src/features/dashboard-widgets/` | Individual widget card with list/metric/donut rendering. |
| `WidgetConfigDialog` | `src/features/dashboard-widgets/` | Dialog for adding and configuring widgets (source, type, fields). |
| `RealtimeDashboardSyncProvider` | `src/features/realtime/` | WebSocket connection provider that invalidates query caches on entity events. |

---

## Testing Plan

### Backend E2E

- [ ] Not applicable — the Dashboard has no dedicated backend endpoints. Test coverage exists in the individual module E2E tests.

### Frontend

- [ ] Visual QA: Dashboard grid renders at multiple breakpoints (mobile, tablet, desktop).
- [ ] Widget types: Add a list widget, metric widget, and donut widget — verify each renders data correctly.
- [ ] Real-time: Create a workshop order → Verify the workshop widget updates without page refresh.
- [ ] Navigation: Click a widget → verify navigation to the correct source list with filter applied.
- [ ] Remove widget: Remove a widget → verify it disappears and grid re-flows.
- [ ] Empty state: Dashboard with no widgets shows an "Add Widget" prompt.

---

## Open Questions

1. **Widget persistence:** Are widget configurations stored in browser `localStorage` only, or should they be persisted server-side (per-user settings) for cross-device consistency?
2. **Shared dashboards:** Should users be able to share dashboard configurations with teammates?
3. **Widget refresh interval:** Current stale time is 5 minutes. Is this appropriate, or should specific sources (e.g., Workshop Orders) refresh more frequently?
4. **Mobile layout:** Should the dashboard degrade to a single-column layout on mobile, or should mobile users see a simplified view?

---

## References

- ADR-0001: Prisma Real-Time Sync — the Dashboard is the primary consumer of WebSocket events
- ADR-0005: Deletion Policy — `DELETED` events trigger cache invalidation for affected widgets
- All module Feature Specs — each module's list endpoints are consumed as widget data sources
- `src/features/realtime/dashboard-entity-map.ts` — entity-to-query-key mapping
- `src/features/dashboard-widgets/sources.ts` — widget data source definitions

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Backfilled Spec |
