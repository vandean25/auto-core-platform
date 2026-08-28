# Workshop and Vehicle Row Navigation Design

## Goal

Make rows on the Workshop Orders, Vehicles, and Vehicle Stock list pages reliably open their corresponding detail views when clicked, while preserving existing table controls and context-menu actions.

## Scope

The affected routes are:

- `/workshop/orders` → `/workshop/orders/:orderId`
- `/vehicles` → `/vehicles/:vehicleId`
- `/vehicle-stock` → `/vehicle-stock/:vehicleId` for received stock, or `/vehicle-stock/purchases/:purchaseId` for draft purchases

The change is limited to the shared `DataTable` row activation behavior and frontend regression coverage. No backend or API contract changes are required.

## Current Context

All three list pages already provide `onRowClick` callbacks to `DataTable`, but the behavior is not covered consistently and users report that the rows do not open their detail views. `DataTable` also supports keyboard activation and right-click context actions, so the fix must keep those interaction paths coherent.

## Recommended Approach

Use the shared `DataTable` as the single owner of row activation. Normalize the row event handling so a row with `onRowClick` is an accessible interactive row: pointer activation invokes the callback for ordinary row content, while clicks originating in buttons, links, form controls, or other explicitly interactive descendants remain owned by those controls. Keyboard Enter and Space continue to activate the row, and context-menu keyboard/pointer gestures continue to open row actions.

The list pages retain their existing navigation callbacks and vehicle-stock destination resolver. This avoids duplicating table markup or adding three page-specific workarounds.

## Components and Data Flow

1. A list page fetches and maps API data into its existing row type.
2. The list page passes `onRowClick` to `DataTable`.
3. `DataTable` renders each data row with a stable `data-table-row="true"` attribute and an activation handler.
4. For ordinary row clicks, `DataTable` calls the page callback with the row object.
5. The page callback navigates to the configured detail route for that row type.
6. Interactive descendants and pagination/toolbar controls do not trigger row navigation.

## Interaction and Accessibility Requirements

- Clicking any non-control area of a data row opens that row’s detail destination.
- Enter or Space on a focused data row opens the same destination.
- Buttons, links, inputs, selects, textareas, and elements with `role="button"` keep their own click behavior and do not navigate the row.
- Right-clicking a row continues to open its context actions when actions exist.
- Rows with an activation callback remain keyboard-focusable and visibly indicate clickability through the existing hover/cursor styling.
- Loading and empty-state rows are not navigable.

## Testing Strategy

Add frontend regression coverage that renders the actual list-page paths with mocked API responses and verifies:

- Workshop order row click navigates to `/workshop/orders/:id`.
- Vehicle row click navigates to `/vehicles/:id`.
- Received vehicle-stock row click navigates to `/vehicle-stock/:id`.
- Draft vehicle-stock row click navigates to `/vehicle-stock/purchases/:id`.
- Existing vehicle-stock context-menu Delete behavior remains intact.
- Shared row keyboard activation and interactive-descendant protection are covered at the component level if the implementation changes the shared event handling.

Use the existing Playwright `AutoCorePage.openRowDetails` helper and route-mocking conventions. No API types, generated OpenAPI artifacts, migrations, or deletion-policy changes are expected.

## Error Handling

Navigation remains client-side through React Router. API failures continue to be handled by the existing list-page loading/error behavior; the row interaction itself does not introduce new network calls or error states.

## Non-Goals

- Redesigning list-page columns, search, sorting, pagination, or context-menu UX.
- Changing detail-page routes or backend endpoints.
- Adding row-level edit/delete buttons.
- Refactoring unrelated table consumers.
