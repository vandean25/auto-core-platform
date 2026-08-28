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
| VoiceTranslationSettings | No | Singleton tenant configuration record for voice translation; update in place only. |
| CatalogProviderSettings | No | Singleton tenant configuration for identity/parts/labor adapters; update in place only. |
| CatalogOemConcern | Conditional | Hard delete when no `CatalogOemConcernMake` rows remain. |
| CatalogOemConcernMake | Yes | Hard delete allowed; that vehicle make returns to automatic aftermarket. |
| VehicleMakeAlias | Yes | Hard delete allowed. Decoder aliases are master data. |
| PartsRequisition | Draft-only | Allow only in `DRAFT`. After `ORDERED`, cancel; do not hard-delete linked reservations. |
| PartsRequisitionLine | No direct delete | Managed by parent requisition / reservation cancel. |
| PartsReservation | Cancel / release only | `OPEN`, `ORDERED`, or `STAGED` → `CANCELLED` via **Release** (return `quantity_staged` only, drop on-hand reserved, detach remaining PO demand, keep `purchase_order_item_id`). Never reverse `WORKSHOP_CONSUMPTION`. No hard delete. |
| RevenueGroup | Conditional | Allow only when no `CatalogItem` references it. |
| Brand | Conditional | Allow only when no `CatalogItem`, `Vendor.supportedBrands`, `Vehicle.make_brand_id`, `VehicleMakeAlias`, or `CatalogOemConcernMake` references it. |
| CatalogItem | No (current API) | Inventory ledger and historical documents depend on item identity; use supersession/inactive approach. |
| StorageLocation | Conditional (soft delete) | Allow only when no child locations and no stock exists; soft-delete via `deletedAt`. |
| InventoryStock | No | Derived operational state; managed by ledger operations. |
| InventoryTransaction | No | Immutable audit trail; never deleted. |
| AuditLog | No | Business audit ledger record; never deleted through ordinary APIs. |
| Vendor | Conditional | Allow only when no `PurchaseOrder`, no `PurchaseInvoice`, and no `VehiclePurchase` references exist. |
| PurchaseOrder | Draft-only | Allow only in `DRAFT` and only if no received quantity and no purchase invoice links. |
| PurchaseOrderItem | No direct delete | Managed by parent `PurchaseOrder` lifecycle. |
| Customer | Conditional | Allow only when no `SalesOrder`, `Invoice`, `WorkshopOrder`, linked `Vehicle`, `VehiclePurchase` (as seller), or `VehicleSale` (as buyer). |
| Vehicle | Conditional | Blocked if linked to any `WorkshopOrder`, `SalesOrder`, `Invoice`, `VehiclePurchase`, `VehicleSale`, or `VehicleLedgerEntry`. |
| SalesOrder | Draft-only | Allow only in `DRAFT` and only when no linked `Invoice` exists. |
| SalesOrderItem | No direct delete | Managed by parent `SalesOrder` lifecycle. |
| Invoice | No | Financial/legal document; use status cancellation flow. |
| InvoiceItem | No direct delete | Managed by parent `Invoice` lifecycle. |
| PurchaseInvoice | Draft-only | Allow only in `DRAFT`. Posted and paid bills are financial documents; use the status lifecycle (`DRAFT`, `POSTED`, `PAID`). |
| PurchaseInvoiceLine | No direct delete | Managed by parent `PurchaseInvoice` lifecycle. |
| User | No direct delete | Identity record persists for auditability; deactivate memberships instead of deleting the user. |
| TenantMember | Conditional (soft-disable preferred) | Set `is_active = false` first; hard delete only when no audit or access-history requirement remains. |
| PlatformAdmin | No direct delete | Remove elevated claims and deactivate the record instead of deleting it. |
| Bay | Conditional (future API) | DB FK is `ON DELETE SET NULL` from `WorkshopOrder.bay_id`; if delete API is added, default to deactivation (`is_active = false`) and allow hard delete only under explicit business rules. |
| WorkshopSettings | No | Singleton configuration record; never deleted. Update in place only. |
| WorkshopOpeningHour | No | Seven weekday rows; replaced by updating hours, never deleted independently. |
| WorkshopHoliday | Yes | Hard delete allowed. Not referenced by orders. Removing a holiday only changes future grid hours. |
| WorkshopOrder | Conditional | Hard delete allowed only while `SCHEDULED` (planner no-show). Blocked from `INTAKE` onward unless a future cancel API is added. |
| WorkshopTask | Conditional | Allow only when parent `WorkshopOrder` is not `INVOICED`, no linked invoice exists yet on the order, no `LaborEntry` records exist for the task, and **no child line has a `PartsReservation` or inventory activity**. |
| WorkshopTaskLineItem | Soft-cancel after operational history | Hard delete forbidden once any `PartsReservation` or `InventoryTransaction` exists. Consumed > 0: leftover-release shrinks `quantity` to consumed, status `CONSUMED` (still billable). Consumed = 0: status `CANCELLED`. Keep the row so reservations retain `workshop_task_line_item_id`. `replaceTaskLineItems` must not `deleteMany` operational lines. |
| InspectionTemplate | Conditional | Cannot delete if any `WorkshopInspection` references it; deactivate or supersede it instead. |
| InspectionTemplateItem | Conditional | Cannot delete if any `WorkshopInspectionItem` references it; change future template versions instead. |
| WorkshopInspection | Conditional | Cannot delete after the parent order is completed; before completion only manager-controlled void/delete flows should be allowed. |
| WorkshopInspectionItem | No direct delete | Managed by the parent `WorkshopInspection` lifecycle and should not be deleted independently after completion. |
| WorkshopMedia | Conditional | Cannot delete after the parent order is completed; before completion, only failed or unattached media may be removed by mechanics, otherwise manager-only. |
| WorkshopVoiceNoteDraft | No direct delete | Immutable audit-support record for voice-note transcription/translation acceptance history; status transitions (`PENDING` -> `ACCEPTED`) only. Records may be removed only by parent `WorkshopTask` cascade deletion. |
| VoiceNoteRateLimit | No API delete | Ephemeral per-mechanic voice-note upload counter. Rows expire by TTL window and cascade-delete with `Tenant` or `Employee`. |
| LaborEntry | No | Immutable audit trail of mechanic time intervals; never hard-deleted through the API. The nightly close-out job may set `ended_at` and `pause_reason = AUTO_SHIFT_CLOSE` on open entries, but does not delete records. |
| InvoiceSequence | No | Numbering integrity record; never deleted. |
| VehiclePurchase | Draft-only | Allow only in `DRAFT` with no `VehicleLedgerEntry` and `status != RECEIVED`. Received purchases are financial/stock history. |
| VehicleSale | Draft-only | Allow only in `DRAFT` with no linked `Invoice`. Invoiced sales are financial documents. |
| VehicleLedgerEntry | No | Immutable vehicle cost/movement audit trail; never deleted through ordinary APIs. |
| LaborCategory | Conditional | Allow only when no `LaborOperation` references it, no child categories exist, and it is not `CatalogProviderSettings.default_labor_category_id`. `WorkshopTaskLineItem.labor_category_id` uses `ON DELETE SET NULL` (hourly/cost rates are snapshotted on the line). |
| LaborOperation | Soft-delete only | Set `is_active = false`; hard delete is not allowed through the API. |
| Employee | Soft-disable preferred | Set `is_active = false`. Hard delete returns `409` if `WorkshopOrder.mechanic_id`, work records (`WorkshopTask`, `WorkshopMedia`, `WorkshopVoiceNoteDraft`, `LaborEntry`), or HR records (`AttendanceEvent`, `LeaveRequest`, `EmployeeLeaveBalance`) reference this employee. `EmployeeWorkSchedule` rows cascade on employee hard-delete — not a separate 409 reason. |
| EmployeeWorkSchedule | No API delete | Versioned expected work pattern per employee. Correct times via PATCH; add versions via POST. Rows cascade on employee hard-delete or tenant purge. Parent PATCH is audited. |
| EmployeeWorkScheduleDay | No direct delete | Seven weekday rows per schedule version; managed by parent `EmployeeWorkSchedule` lifecycle. Cascade with parent schedule. |
| EmployeeLeaveBalance | No API delete | Update allowance/carryover through the leave-balance API. Rows are removed only during tenant purge. |
| LeaveRequest | Soft-cancel | Set `status = CANCELLED`; no hard-delete API. |
| AttendanceEvent | No delete | Immutable attendance log; corrections are additional events. |
| Bay | Soft-disable preferred | Set `is_active = false`. Hard delete blocked if `WorkshopOrder.bay_id` references this bay. |

## UI Contract

- Show row context `Delete` only for entities with delete support.
- Where delete is state-dependent (for example `PurchaseOrder`, `SalesOrder`, `PurchaseInvoice`), hide the action when clearly disallowed.
- Always rely on backend as source of truth and surface API error messages.

## References

- ADR-0005: Deletion Policy Enforcement
- ADR-0013: Row-Level Multi-Tenancy & Tenant Isolation
- ADR-0015: Audit Tracing and Operational Logging — AuditLog ledger immutability
- ADR-0021 / Vehicle Intelligence spec — LaborCategory default, Brand vehicle-make refs, PartsReservation **release**

