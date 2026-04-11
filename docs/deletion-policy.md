# Entity Deletion Policy

This document defines when deletion is allowed in Auto Core Platform.

## Principles

- Use hard delete only for clean master data that has never been used operationally.
- Use draft-only delete for transactional entities before stock/finance impact.
- Once financial, inventory, or legal history exists, deletion is blocked.
- Prefer status transitions (`CANCELLED`, `VOID`, `ARCHIVED`) over deletion for business records.

## Policy Matrix

| Entity | Delete Allowed | Rule |
|---|---|---|
| FinanceSettings | No | Singleton configuration record; never deleted. |
| RevenueGroup | Conditional | Allow only when no `CatalogItem` references it. |
| Brand | Conditional | Allow only when no `CatalogItem` or `Vendor.supportedBrands` reference it. |
| CatalogItem | No (current API) | Inventory ledger and historical documents depend on item identity; use supersession/inactive approach. |
| StorageLocation | Conditional (soft delete) | Allow only when no child locations and no stock exists; soft-delete via `deletedAt`. |
| InventoryStock | No | Derived operational state; managed by ledger operations. |
| InventoryTransaction | No | Immutable audit trail; never deleted. |
| Vendor | Conditional | Allow only when no `PurchaseOrder` and no `PurchaseInvoice` references exist. |
| PurchaseOrder | Draft-only | Allow only in `DRAFT` and only if no received quantity and no purchase invoice links. |
| PurchaseOrderItem | No direct delete | Managed by parent `PurchaseOrder` lifecycle. |
| Customer | Conditional | Allow only when no `SalesOrder`, `Invoice`, `WorkshopOrder`, and no linked `Vehicle`. |
| Vehicle | Conditional (future) | Should be blocked if linked to orders/invoices/workshop records. |
| SalesOrder | Draft-only | Allow only in `DRAFT` and only when no linked `Invoice` exists. |
| SalesOrderItem | No direct delete | Managed by parent `SalesOrder` lifecycle. |
| Invoice | No | Financial/legal document; use status cancellation flow. |
| InvoiceItem | No direct delete | Managed by parent `Invoice` lifecycle. |
| PurchaseInvoice | No | Financial document; use status lifecycle (`DRAFT`, `POSTED`, `PAID`). |
| PurchaseInvoiceLine | No direct delete | Managed by parent `PurchaseInvoice` lifecycle. |
| WorkshopOrder | Conditional (future API) | Prefer cancel/archive flow; if delete is added, limit to pre-work intake states only. |
| WorkshopTask | Conditional | Allow only when parent `WorkshopOrder` is not `INVOICED` and no linked invoice exists yet on the order. |
| InvoiceSequence | No | Numbering integrity record; never deleted. |
| LaborCategory | Conditional | Allow only when no `LaborOperation` references it (i.e. `labor_operations` relation is empty) and no child categories exist. |
| LaborOperation | Soft-delete only | Set `is_active = false`; hard delete is not allowed through the API. |

## UI Contract

- Show row context `Delete` only for entities with delete support.
- Where delete is state-dependent (for example `PurchaseOrder`, `SalesOrder`), hide the action when clearly disallowed.
- Always rely on backend as source of truth and surface API error messages.
