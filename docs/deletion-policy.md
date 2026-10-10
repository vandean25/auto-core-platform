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
| LegalEntity | Deactivate preferred | Set `is_active = false` **only when every site of the entity is already inactive** (422 while any `Site.is_active`). Hard delete only when the entity has **no sites** (unused setup mistake). |
| Site | Deactivate preferred | Set `is_active = false` **only when**, under a site-row lock, remaining `StockTransfer` rows (from or to) are `COMPLETED`/`REJECTED`/`CANCELLED`; remaining site-owned documents are terminal (`WorkshopOrder` `INVOICED`; `SalesOrder` `INVOICED`; `PurchaseOrder` `COMPLETED`; `VehiclePurchase` `RECEIVED`/`CANCELLED`; `VehicleSale` `INVOICED`/`CANCELLED`); no on-hand, reserved, or in-transit qty; **and no non-`SOLD` dealer vehicle has a `vehicle_lot` at this site** (lot-only; never `VehiclePurchase.site_id`). `VehiclePurchase` `DRAFT` is a non-terminal document. 422 otherwise. Creates/receipts/transfers/moves that target the site recheck `is_active` on the same lock. There is no `WorkshopOrderStatus.CANCELLED` or `SalesOrderStatus.CANCELLED`. Hard delete only for a pristine unused site: no transfers, no ledger history, no storage locations (except the empty system `in_transit` location, which may be removed **internally** with the site), no memberships, no bays, no parked vehicles, and no site-owned documents (workshop/sales/purchase/vehicle). Direct delete of the system transit location is forbidden. |
| SiteMembership | Yes | Hard delete allowed. If the row matches `User.active_site_id`, clear `active_site_id` atomically in the same transaction. |
| StockTransfer | No | Operational/financial movement document; use `REJECTED` / `CANCELLED` / complete via receive+return. Never hard-delete after create. |
| StockTransferLine | No direct delete | Managed by parent `StockTransfer` lifecycle. |
| StockTransferCommand | No | Durable receive/return idempotency record. Unique `(tenant_id, transfer_id, action, idempotency_key)`. Required `created_at`. Never deleted through ordinary APIs; tenant purge only. Unbounded in slice 1 — do **not** purge when the parent transfer is `COMPLETED`. A later retention spec may add a COMPLETED + N-days rule. |
| VoiceTranslationSettings | No | Singleton tenant configuration record for voice translation; update in place only. |
| CatalogProviderSettings | No | Singleton tenant configuration for identity/parts/labor adapters; update in place only. |
| CatalogOemConcern | Conditional | Hard delete when no `CatalogOemConcernMake` rows remain. |
| CatalogOemConcernMake | Yes | Hard delete allowed; that vehicle make returns to automatic aftermarket. |
| VehicleMakeAlias | Yes | Hard delete allowed. Decoder aliases are master data. |
| PartsRequisition | Draft-only | Allow only in `DRAFT`. After `ORDERED`, no hard delete. Terminal states require **at least one slice**. `COMPLETED` iff zero active **and** ≥1 `FULFILLED` (mixed `FULFILLED`+`CANCELLED` with zero active included). `CANCELLED` iff ≥1 slice and **every** slice is `CANCELLED`. Zero-slice sheets stay `DRAFT`. One `FULFILLED` plus an active slice stays `ORDERED` (or `DRAFT` if never SENT). |
| PartsRequisitionLine | No direct delete | Managed by parent requisition / reservation cancel. |
| PartsReservation | Cancel / release / fulfill | `OPEN`, `ORDERED`, or `STAGED` → `CANCELLED` via **Release** (return `quantity_staged` only, drop on-hand reserved, detach remaining SENT PO demand, keep `purchase_order_item_id`). Consume → **`FULFILLED`** when remaining commitment and staged qty are 0. DRAFT PO/item delete **cancels** the reservation (`CANCELLED`, `purchase_order_item_id` null) so line shortage reappears. Never reverse `WORKSHOP_CONSUMPTION`. No hard delete of the reservation. |
| PurchaseOrder | Draft-only | Allow only in `DRAFT` with no received qty and no purchase invoice links. Linked reservations must be **cancelled and unlinked** in the same transaction (tasks → … → PO header lock) before header/item delete. |
| PurchaseOrderItem | Conditional | Unlinked items: existing parent-lifecycle delete. Reservation-linked: DRAFT+unreceived → cancel reservation then delete; SENT/received/staged → 409. `onDelete: Restrict` from `PartsReservation`. |
| RevenueGroup | Conditional | Allow only when no `CatalogItem` references it. |
| Brand | Conditional | Allow only when no `CatalogItem`, `Vendor.supportedBrands`, `Vehicle.make_brand_id`, `VehicleMakeAlias`, or `CatalogOemConcernMake` references it. |
| CatalogItem | No (current API) | Inventory ledger and historical documents depend on item identity; use supersession/inactive approach. |
| StorageLocation | Conditional (soft delete) | Allow only when no child locations and no stock exists; soft-delete via `deletedAt`. **Block** while outstanding `StockTransfer` qty references this location as **source** (including in-transit remaining) **or as frozen dest** (`dest_location_id` on a line with `shipped_qty > received_qty + returned_qty`), even if dest on-hand is already zero. **Block disable / soft-delete / hard-delete** while any non-`SOLD` dealer vehicle (`IN_STOCK`/`RESERVED`/`IN_PREP`) has `Vehicle.location_id` = this lot (move or sell first). `VehicleLot` FK is `onDelete: Restrict` (live code is `SetNull`). System `in_transit` locations: no direct delete, no disable; removed only internally when a pristine site is hard-deleted. |
| InventoryStock | No | Derived operational state; managed by ledger operations. |
| InventoryTransaction | No | Immutable audit trail; never deleted. Includes transfer ship/receive/return pairs (`movement_group_id`). |
| AuditLog | No | Business audit ledger record; never deleted through ordinary APIs. |
| AgentActionLog | No | Append-only agent action trace ledger; no update/delete API. |
| DecisionShadowLog | No | Append-only shadow decision log; no update/delete API. |
| AgentProposal | No | Retained for audit; soft status change via rejection/approval lifecycle. Never hard-deleted through ordinary APIs; tenant-scoped purge only on tenant deletion. |
| Vendor | Conditional | Allow only when no `PurchaseOrder`, no `PurchaseInvoice`, and no `VehiclePurchase` references exist. |
| Customer | Conditional | Allow only when no `SalesOrder`, `Invoice`, `WorkshopOrder`, linked `Vehicle`, `VehiclePurchase` (as seller), or `VehicleSale` (as buyer). |
| Vehicle | Conditional | Blocked if linked to any `WorkshopOrder`, `SalesOrder`, `Invoice`, `VehiclePurchase`, `VehicleSale`, `VehicleLedgerEntry`, or `LoanerVehicle` fleet entry. |
| SalesOrder | Draft-only | Allow only in `DRAFT` and only when no linked `Invoice` exists. |
| SalesOrderItem | No direct delete | Managed by parent `SalesOrder` lifecycle. |
| Invoice | No | Financial/legal document; use status cancellation flow. |
| InvoiceItem | No direct delete | Managed by parent `Invoice` lifecycle. |
| PurchaseInvoice | Draft-only | Allow only in `DRAFT`. Posted and paid bills are financial documents; use the status lifecycle (`DRAFT`, `POSTED`, `PAID`). |
| PurchaseInvoiceLine | No direct delete | Managed by parent `PurchaseInvoice` lifecycle. |
| User | No direct delete | Identity record persists for auditability; deactivate memberships instead of deleting the user. |
| TenantMember | Conditional (soft-disable preferred) | Set `is_active = false` first; hard delete only when no audit or access-history requirement remains. |
| TenantApiKey | No (revoke only) | Revoke by setting `revoked_at` (idempotent, immediate). No hard delete through any API. Rows stay for the audit trail and are removed only by tenant purge (ADR-0026). |
| PlatformAdmin | No direct delete | Remove elevated claims and deactivate the record instead of deleting it. |
| Bay | Conditional (future API) | DB FK is `ON DELETE SET NULL` from `WorkshopOrder.bay_id`; if delete API is added, default to deactivation (`is_active = false`) and allow hard delete only under explicit business rules. |
| WorkshopSettings | No (removed) | Tenant singleton is replaced by per-site fields on `Site` (ADR-0022). Do not reintroduce a tenant-wide hours singleton. |
| WorkshopOpeningHour | No | Seven weekday rows **per site**; replaced by updating hours, never deleted independently. Cascade when a pristine site is hard-deleted. |
| WorkshopHoliday | Yes | Hard delete allowed (site-scoped). Not referenced by orders. Removing a holiday only changes future grid hours for that site. |
| LoanerVehicle | Conditional | Soft-disable via `active = false` preferred. Hard delete only when no `LoanerBooking` rows reference the fleet entry. |
| LoanerBooking | Status lifecycle | No hard delete. Use `CANCELLED`, `RETURNED`, or `NO_SHOW`. Hand-over/return fields are retained for audit. |
| WorkshopOrder | Conditional | Hard delete allowed only while `SCHEDULED` (planner no-show). Blocked from `INTAKE` onward unless a future cancel API is added. A `WarrantyClaim` on the order also blocks hard delete (`RESTRICT`); claims cannot be filed on a `SCHEDULED` order. |
| WorkshopTask | Conditional | Allow only when parent `WorkshopOrder` is not `INVOICED`, no linked invoice exists yet on the order, no `LaborEntry` records exist for the task, and **no child line has a `PartsReservation` or inventory activity**. |
| WorkshopTaskLineItem | Soft-cancel after operational history | Hard delete forbidden once any `PartsReservation` or `InventoryTransaction` exists. Consumed > 0: leftover-release shrinks `quantity` to consumed, status `CONSUMED` (still billable). Consumed = 0: status `CANCELLED`. Keep the row so reservations retain `workshop_task_line_item_id`. `replaceTaskLineItems` must not `deleteMany` operational lines. A line referenced by a `WarrantyClaimLine` cannot be hard-deleted either: the line replacement and the task delete refuse it with 409 `WARRANTY_CLAIM_LINE_REFERENCED`. While the claim is `DRAFT`, remove the line from the claim first; once a claim has left `DRAFT` its lines stay on the order for the audit trail. |
| WarrantyClaim | No (close instead) | Retained for the audit trail and the OEM reference; no delete API. Status runs `DRAFT` → `SUBMITTED_EXTERNALLY` → `APPROVED` or `REJECTED` → `CLOSED`, and `CLOSED` is terminal. Type, complaint, cause/correction, lines and claimed amount are editable only in `DRAFT`; external reference and decision fields stay editable until `CLOSED`. Every change is written to the audit log. |
| WarrantyClaimLine | Owned by claim | Added and removed only while its claim is `DRAFT`; cascades with the claim, never deleted after submission. Each line snapshots the order line (type, item number, description, quantity, unit price, net amount) when it is attached; lines that stay on the claim keep their snapshot. References `WorkshopTaskLineItem` with `RESTRICT`. A line may belong to one claim that is not `CLOSED` at a time. Cancelled part lines cannot be attached or submitted. |
| InspectionTemplate | Conditional | Cannot delete if any `WorkshopInspection` references it; deactivate or supersede it instead. |
| InspectionTemplateItem | Conditional | Cannot delete if any `WorkshopInspectionItem` references it; change future template versions instead. |
| WorkshopInspection | Conditional | Cannot delete after the parent order is completed; before completion only manager-controlled void/delete flows should be allowed. |
| WorkshopInspectionItem | No direct delete | Managed by the parent `WorkshopInspection` lifecycle and should not be deleted independently after completion. |
| WorkshopMedia | Conditional | Cannot delete after the parent order is completed; before completion, only failed or unattached media may be removed by mechanics, otherwise manager-only. |
| WorkshopVoiceNoteDraft | No direct delete | Immutable audit-support record for voice-note transcription/translation acceptance history; status transitions (`PENDING` -> `ACCEPTED`) only. Records may be removed only by parent `WorkshopTask` cascade deletion. |
| VoiceNoteRateLimit | No API delete | Ephemeral per-mechanic voice-note upload counter. Rows expire by TTL window and cascade-delete with `Tenant` or `Employee`. |
| LaborEntry | No | Immutable audit trail of mechanic time intervals; never hard-deleted through the API. The nightly close-out job may set `ended_at` and `pause_reason = AUTO_SHIFT_CLOSE` on open entries, but does not delete records. |
| InvoiceSequence | No | Numbering integrity record; never deleted. |
| VehiclePurchase | Draft-only | Allow only in `DRAFT` with no `VehicleLedgerEntry` and `status != RECEIVED`. Received purchases are financial/stock history. A `TRADE_IN` purchase (AUT-443) is owned by its `VehicleSale`: it is created, edited and removed only through the sale's trade-in endpoints while the sale is `DRAFT`; cancel and generic delete/patch are refused, and `VehicleSale.trade_in_purchase_id` is a `RESTRICT` foreign key. |
| VehicleSale | Draft-only | Allow only in `DRAFT` with no linked `Invoice`. Invoiced sales are financial documents. A draft sale may hold one trade-in (`trade_in_purchase_id`); removing it unlinks the sale first and then deletes the draft trade-in purchase. |
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
| TyreSet | Conditional | Hard delete only when no `TyreSetEvent` exists (FK RESTRICT; otherwise 409 — record a dispose event instead). Not inventory — no ledger impact. |
| TyreSetEvent | No | Append-only storage ledger; never updated or deleted through the API. |
| TyreStorageSettings | No | Tenant singleton; update in place only. |
| VendorArticle | Conditional / Hard delete allowed | Hard delete allowed; mapping between vendor article and catalog item. Unlinking vendor article does not affect catalog item or historical documents. |
| MarginRule | Soft-disable preferred | Soft-disable via `is_active = false` preferred. Hard delete allowed if unused. |
| CatalogPriceHistory | No | Immutable price audit trail; never deleted through ordinary APIs. |

## ADR-0026 — Tenant API keys (AUT-411)

- `TenantApiKey` is never hard-deleted through an API. Revocation sets `revoked_at` and takes effect on the next request. Expiry is a time-based state (`expires_at`), not a deletion.
- Revocation is the only lifecycle exit. A revoked row keeps its `secret_hash` so the audit history stays verifiable. The hash is never returned by any API.
- `AgentActionLog` rows that carry an `api_key_id` are business audit records. They are never deleted through ordinary APIs.
- Tenant purge removes `tenant_api_keys` (generated purge SQL, `tools/tenant-restore/`).

## ADR-0023 — Legal invoicing and accounting export

The following are the **accepted policy baseline** from [ADR-0023](internal/01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md) (Product Owner acceptance 2026-09-20). They are not claims about current API enforcement until implementation ships. Existing policy above continues to describe current entities until that rollout.

| Entity | Planned delete support | Rule |
|---|---|---|
| LegalEntity | Conditional | Preserve existing site guards; additionally block hard deletion while Invoice, CreditNote, AccountingExport or a used accounting profile references it. |
| Invoice (version 2) | No | No status-only cancellation as a financial reversal. Issue a separate numbered credit; retain original snapshot, number and fiscal status. |
| CreditNote | No | DRAFT may transition to VOID without a number. FINALIZED and VOID are retained; no hard-delete endpoint. |
| CreditNoteItem | Draft-parent edits only | Draft line replacement allowed; finalized/void lines retained. No independent deletion endpoint. |
| CreditNoteSequence | No | Numbering integrity record; never reset/recycle consumed numbers or delete through ordinary APIs. |
| LegalEntityAccountingProfile | No after use | Versioned updates; no ordinary delete endpoint once used. Frozen document/run allocations survive profile changes. |
| AccountingExport | No | Retain exact bytes, manifest, frozen profile, checksum and actor/time. No ordinary delete endpoint or short TTL. |

Retention and tenant-purge exceptions require a separate approved policy; this baseline authorizes no historical deletion or snapshot repair.

## ADR-0024 / AUT-318 — Document branding rules

ADR-0024 is accepted; the following detailed lifecycle rules are the **approved baseline from the [AUT-318 feature spec](internal/02-Feature-Specs/Finance/document-branding-and-letterhead.md)** (Dejan Dosenovic, Product Owner, 2026-09-27). They are not claims about current API enforcement until implementation ships.

| Entity | Planned delete support | Rule |
|---|---|---|
| DocumentBrandProfile | Reset / discard draft | Reset confirms a new ACP-default revision; discard removes only the draft. No public hard-delete endpoint. Issued snapshots and referenced assets remain intact. |
| DocumentBrandAsset | Conditional cleanup | Never delete while referenced by an active/draft profile, unexpired proposal/active extraction or committed invoice. Only a retained `InvoiceBrandAssetReference` protects a logo's exact object generation for the invoice's lifetime; profile references block cleanup while the profile points to the asset. READY logos retain a 7-day grace period, and their cleanup stays disabled until AUT-323 reference enforcement is deployed and enabled. Quarantined/rejected uploads expire after 24 hours and are the only asset class cleaned by AUT-322. READY source uploads carry a 30-day retention date but cleanup stays disabled until AUT-324 extraction references exist. Cleanup locks entity/assets, rechecks every reference (including committed invoice references, even on a retry for an already-`DELETING` asset), marks `DELETING`, deletes only the exact unreferenced object generation, then retains a metadata tombstone. |
| DocumentBrandExtraction | Discard / expire payload | Discard never changes active branding. Expire source/proposal payloads after 30 days once jobs are terminal; retain safe metadata for audit. Referenced logo assets follow their own retention guards. |
| InvoiceBrandAssetReference | No | Retained with the committed invoice; no ordinary delete endpoint or short TTL. |
| Branded invoice PDF | No overwrite/delete | Publish once; retain exact archive generation/bytes. Archive objects are excluded from short bucket lifecycle deletion. Profile reset, asset cleanup and task retry cannot overwrite or remove them. |
| LegalEntity | Existing guards plus branding retention | Preserve current site/finance guards. Retained branding history blocks hard deletion; only unused, unprotected branding setup can be removed with an otherwise deletable entity. |

Active-reference changes, invoice commitment and cleanup serialize on the legal entity before child rows. Cleanup must not race a first profile or invoice reference. A relational FK is not a cleanup guard by itself: cleanup rechecks committed references under the entity lock before marking an asset `DELETING` and again on retries before deleting the exact GCS generation. Do not apply short GCS lifecycle rules to retained logo generations or invoice archives. These rules grant no tenant-purge or fiscal-retention exception.

## UI Contract

- Show row context `Delete` only for entities with delete support.
- Where delete is state-dependent (for example `PurchaseOrder`, `SalesOrder`, `PurchaseInvoice`), hide the action when clearly disallowed.
- Always rely on backend as source of truth and surface API error messages.

## References

- ADR-0005: Deletion Policy Enforcement
- ADR-0013: Row-Level Multi-Tenancy & Tenant Isolation
- ADR-0015: Audit Tracing and Operational Logging — AuditLog ledger immutability
- ADR-0021 / Vehicle Intelligence spec — LaborCategory default, Brand vehicle-make refs, PartsReservation **release**
- ADR-0022 / Multi-Location spec — `LegalEntity`, `Site`, `SiteMembership`, `StockTransfer`, `StockTransferCommand`; site-owned documents; system `in_transit` locations; site/entity deactivation guards

