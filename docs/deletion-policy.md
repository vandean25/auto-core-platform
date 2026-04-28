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
| User | No direct delete | Identity record persists for auditability; deactivate memberships instead of deleting the user. |
| TenantMember | Conditional (soft-disable preferred) | Set `is_active = false` first; hard delete only when no audit or access-history requirement remains. |
| PlatformAdmin | No direct delete | Remove elevated claims and deactivate the record instead of deleting it. |
| Employee | Conditional (future API) | DB FK is `ON DELETE SET NULL` from `WorkshopOrder.mechanic_id`; if delete API is added, default to deactivation (`is_active = false`) and allow hard delete only under explicit business rules. |
| Bay | Conditional (future API) | DB FK is `ON DELETE SET NULL` from `WorkshopOrder.bay_id`; if delete API is added, default to deactivation (`is_active = false`) and allow hard delete only under explicit business rules. |
| WorkshopOrder | Conditional (future API) | Prefer cancel/archive flow; if delete is added, limit to pre-work intake states only. |
| WorkshopTask | Conditional | Allow only when parent `WorkshopOrder` is not `INVOICED`, no linked invoice exists yet on the order, and no `LaborEntry` records exist for the task. |
| InspectionTemplate | Conditional | Cannot delete if any `WorkshopInspection` references it; deactivate or supersede it instead. |
| InspectionTemplateItem | Conditional | Cannot delete if any `WorkshopInspectionItem` references it; change future template versions instead. |
| WorkshopInspection | Conditional | Cannot delete after the parent order is completed; before completion only manager-controlled void/delete flows should be allowed. |
| WorkshopInspectionItem | No direct delete | Managed by the parent `WorkshopInspection` lifecycle and should not be deleted independently after completion. |
| WorkshopMedia | Conditional | Cannot delete after the parent order is completed; before completion, only failed or unattached media may be removed by mechanics, otherwise manager-only. |
| LaborEntry | No | Immutable audit trail of mechanic time intervals; never hard-deleted through the API. The nightly close-out job may set `ended_at` and `pause_reason = AUTO_SHIFT_CLOSE` on open entries, but does not delete records. |
| InvoiceSequence | No | Numbering integrity record; never deleted. |
| LaborCategory | Conditional | Allow only when no `LaborOperation` references it (i.e. `labor_operations` relation is empty) and no child categories exist. |
| LaborOperation | Soft-delete only | Set `is_active = false`; hard delete is not allowed through the API. |
| Employee | Soft-disable preferred | Set `is_active = false`. Hard delete blocked if `WorkshopOrder.mechanic_id` references this employee. |
| Bay | Soft-disable preferred | Set `is_active = false`. Hard delete blocked if `WorkshopOrder.bay_id` references this bay. |

## UI Contract

- Show row context `Delete` only for entities with delete support.
- Where delete is state-dependent (for example `PurchaseOrder`, `SalesOrder`), hide the action when clearly disallowed.
- Always rely on backend as source of truth and surface API error messages.
