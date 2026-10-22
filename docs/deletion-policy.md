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
| WorkshopCommandPreset | Conditional | Soft-disable with `active = false`. Hard delete is refused while the row is referenced by a pending `workshop.booking_package` payload. |
| McpWriteCommandReceipt | No | Durable MCP write idempotency receipt for AUTO/PROPOSE tools. Unique `(tenant_id, command_id)`. Required `created_at`. Never deleted through ordinary APIs; tenant purge only. Unbounded retention until a later spec defines expiry. |
| Vendor | Conditional | Allow only when no `PurchaseOrder`, no `PurchaseInvoice`, and no `VehiclePurchase` references exist. |
| Customer | Conditional | Allow only when no `SalesOrder`, `Invoice`, `WorkshopOrder`, linked `Vehicle`, `VehiclePurchase` (as seller), `VehicleSale` (as buyer), or `VehicleParty` (AUT-641). A customer referenced by a vehicle party returns 409; end the party validity instead. |
| CustomerContactPoint | No direct delete | Tenant-scoped contact identities for consent evidence; managed by consent workflows. Removed only by tenant purge or retention after dependencies expire. |
| CustomerConsent | Retention-bound (AUT-589) | Append-only ledger; no update/delete API. Proof rows carry `retain_until` (withdrawal/unsubscribe + 3 calendar years) and `legal_hold`. Purge only when expired and not on hold. |
| CustomerCommunicationState | No direct delete | Controller-scoped revision fence for consent mutations; tenant purge only. |
| CustomerConsentUnsubscribeToken | Retention-bound (AUT-589) | Stores only token SHA-256 for public marketing opt-out. Kept until `retain_until`; no business delete API. |
| Vehicle | Conditional | Blocked if linked to any `VehicleParty` or `VehicleNotice` (AUT-641, `RESTRICT`), `WorkshopOrder`, `SalesOrder`, `Invoice`, `VehiclePurchase`, `VehicleSale`, `VehicleLedgerEntry`, `LoanerVehicle` fleet entry, or retained `ExternalInspectionResult` / `InspectionReportIdentity` / `InspectionMeasurement` evidence (AUT-533, AUT-592). |
| VehicleMedia | Yes (API) | Hard delete via `DELETE /vehicle-stock/:vehicleId/photos/:photoId` deletes every object key first; the row is removed only when storage delete succeeds (`ignoreNotFound` on missing keys). Failed uploads attempt to delete any objects already written; if that cleanup also fails, the API throws an `AggregateError` with both failures. `POST …/set-cover` and reorder are metadata-only. At most one `is_cover` per vehicle (partial unique index `vehicle_media_one_cover_per_vehicle` in SQL). `Vehicle` delete/deleteMany runs a Prisma extension that purges `tenants/{tenant_id}/vehicles/{vehicle_id}/media/` only after the vehicle row delete succeeds (GCS purge is deferred until an interactive transaction commits). Authorised tenant purge must run `npm run purge:tenant-vehicle-media --workspace=core-api -- <tenant_id>` (or `VehicleMediaService.purgeStoredObjectsForTenant`) **before** `tools/tenant-restore/purge-tenant-data.sql`, because SQL cannot delete GCS objects. No raw upload bytes are retained after processing. |
| VehicleEquipmentOption | Deactivate preferred | Set `active = false`; do not hard-delete codes referenced by `VehicleEquipmentSelection`. Starter codes are seeded per tenant (AUT-566). |
| VehicleEquipmentSelection | No direct delete | Replaced atomically via `PUT /vehicle-stock/:vehicleId/equipment`; removed when parent `Vehicle` is deleted (`CASCADE`). |
| VehicleEquipmentFreeTextItem | No direct delete | Replaced atomically via `PUT /vehicle-stock/:vehicleId/equipment`; removed when parent `Vehicle` is deleted (`CASCADE`). |
| VehicleListing | Retention (AUT-567) | One row per stock purchase cycle; retained for export/removal history once a channel has been exported. Draft unexported listings may be removed in a later lifecycle slice; no public hard-delete API in AUT-567. |
| VehicleListingChannel | No direct delete | Managed with parent `VehicleListing`; per-portal export/removal state is historical. |
| VehicleListingPhoto | No direct delete | Replaced atomically via listing `PATCH` (`photo_ids`); removed when parent listing is deleted (`CASCADE`). Selected media remains pinned while referenced (`VehicleMedia` `RESTRICT`). |
| VehicleInspectionRecord | Conditional | `MANUAL` rows follow existing inspection-record rules. `EBV_IMPORTED` and `LEGACY_IMPORT` (AUT-641) projections are immutable (no PATCH/DELETE API; both return 403). |
| VehicleParty | No direct delete (AUT-641) | Time-bounded vehicle/customer relationship with history. End the validity (`PATCH /vehicles/:id/parties/:partyId`) instead of deleting; imported rows keep their `LEGACY_IMPORT` provenance and `ExternalIdMapping`. `ON DELETE RESTRICT` on tenant, vehicle and customer, so a referenced vehicle or customer cannot be deleted (customer delete returns 409). Removed only by tenant purge, where the generated purge SQL deletes parties before vehicles and customers. |
| VehicleNotice | No direct delete (AUT-641) | Campaign, recall, remark, warning or service-due notice. Resolve (`DONE` / `DISMISSED`) instead of deleting; imported evidence is immutable. `ON DELETE RESTRICT` on tenant and vehicle; `resolved_workshop_order_id` is `ON DELETE SET NULL` on that column only. Created in AUT-641 only by the due-date importer (`SERVICE_DUE`, `OPEN`); the resolve workflow is AUT-642. Removed only by tenant purge, before vehicles and workshop orders. |
| InspectionSourceConnection | Deactivate preferred | Set `is_active = false` and `read_enabled = false`; revoke `secret_ref` independently. Hard delete only when no imports/results reference the connection. |
| InspectionExchangeImport | Retention-bound | Unapplied previews and rejected attempts purge after 30 days unless legal hold or unresolved `CONFLICT`. Applied imports retained with their external result. |
| InspectionReportIdentity | No direct delete | Immutable ZBD report-to-vehicle binding; retained while associated external results exist. |
| ExternalInspectionResult | No | Append-only applied evidence; corrections are new revisions, not updates. Tenant purge only. |
| InspectionExchangeEvent | No | Append-only audit correlation for imports/results. Tenant purge only. |
| InspectionCatalogueVersion | No | Immutable activated source manifest; new versions supersede activation only. Tenant purge only. |
| InspectionCatalogueEntry | No | Immutable rows for an activated catalogue version. Tenant purge only. |
| TenantInspectionCatalogueActivation | Deactivate preferred | New activation sets `deactivated_at` on prior row; history retained. |
| InspectionCatalogueImport | Retention-bound | Unapplied previews purge after 30 days unless legal hold or unresolved `CONFLICT`. Activated imports retained with their version. |
| InspectionFindingReference | No | Immutable snapshot on a workshop inspection; deleting checklist/order/site does not cascade-remove references (FK `Restrict`). |
| InspectorEvidenceRevision | No | Append-only restricted HR evidence; review corrections are new revisions. Blocks hard-delete of `Employee` and `Site` while retained (FK `Restrict`). |
| InspectionSupportEvent | No | Append-only cross-contract support audit. Tenant purge only. |
| InspectionDeviceSource | Deactivate preferred | Set `is_active = false` and `read_enabled = false`; revoke `secret_ref` independently. Hard delete only when no measurement imports/results reference the source. |
| InspectionDeviceEvidence | No direct delete | Append-only calibration/range evidence revisions; supersede by new evidence row. Tenant purge only. |
| InspectionMeasurementIdentity | No | Immutable deduplication lock for `(tenant, source_system, source_instance_id, measurement_id)`. Tenant purge only. |
| InspectionMeasurementImport | Retention-bound | Unapplied previews and rejected/quarantined attempts purge after 30 days unless legal hold or unresolved conflict. Applied imports retained with their measurement. |
| InspectionMeasurement | No | Append-only applied brake session evidence; re-tests use new measurement IDs. Tenant purge only. |
| SalesOrder | Draft-only | Allow only in `DRAFT` and only when no linked `Invoice` exists. |
| SalesOrderItem | No direct delete | Managed by parent `SalesOrder` lifecycle. |
| Invoice | No | Financial/legal document; use status cancellation flow. |
| Payment | No | Status transitions only; no hard delete. Tenant purge may remove rows with the tenant. |
| FiscalReceipt | No | Immutable `request_body` and stored `response_body`; no hard delete. |
| FiscalRegister | No | No hard delete in this slice; decommission in fiskaly is a later change. |
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
| WorkshopOrder | Conditional | Hard delete allowed only while `SCHEDULED` (planner no-show). Blocked from `INTAKE` onward unless a future cancel API is added. An order with an estimate is never hard-deleted (`ON DELETE RESTRICT`). A `WarrantyClaim` on the order also blocks hard delete (`RESTRICT`); claims cannot be filed on a `SCHEDULED` order. |
| WorkshopEstimate | Conditional | One Kostenvoranschlag per workshop order (`KV-YYYY-XXXX`). No hard-delete endpoint in v1. Retained with its order. |
| WorkshopEstimateVersion | Retention-bound | No delete endpoint. A `DRAFT` version is replaced by sending or by a later revision. `SENT` and later versions are immutable: snapshot, `snapshot_sha256` and PDF archive are written once. Only `status` moves (`SUPERSEDED`, `APPROVED`, `DECLINED`, `EXPIRED`). Removal only after `retain_until` has passed and `legal_hold` is false (ADR-0025 §10). |
| WorkshopEstimateBrandAssetReference | No direct delete | Pins the frozen logo asset of a sent version. Removed only together with its version row, so asset cleanup treats the logo as in use. |
| WorkshopEstimateApproval | No update or delete endpoint | Evidence for one decision on a sent estimate version (ADR-0025 §7). A customer link decision carries the channel LINK, the token reference, the IP address, the user agent, the typed name and the confirmations. An advisor-recorded decision (AUT-355) carries the channel PHONE, IN_PERSON or EMAIL, the recording user, the amount quoted, the customer reaction, the note and the decision time. Advisor-recorded rows never hold an IP address or a user agent. The frozen snapshot and PDF hashes are on every row. Append-only, one row per version. `ON DELETE RESTRICT` on its tenant, version and token; `ON DELETE SET NULL` on the recording user, so the audit trail keeps the actor. Kept with its version's retention and legal hold. |
| WorkshopEstimateOverrun | No delete endpoint. The notice route is the only writer after detection | Overrun state of one approved baseline (AUT-355, ADR-0025 §1). Written once, when the order first goes over the guide, with the figures at that moment. It holds the advisor's latest notice to the customer (channel, amount, reaction, note, user, time). A later notice, made when the total has moved, replaces the earlier one by a guarded update. A revised version that is approved starts a new baseline and so a new row. Each write is in the audit trail. `ON DELETE RESTRICT` on its tenant and version. Kept with its baseline version's retention and legal hold. |
| WorkshopEstimateApprovalToken | No delete endpoint | Stores only the SHA-256 of an approval token (ADR-0025 §7). Tokens expire at the version's `valid_until` and stay as evidence after that, with `ON DELETE RESTRICT` on their version. A supersession sets `invalidated_at`, and an approval sets `consumed_at`. Removed only with the retention of its version. |
| WorkshopEstimateSequence | No | Numbering counter per tenant and year. Consumed numbers are never reused or reset. |
| NotificationOutbox | Retention-bound | No delete endpoint. Rows stay with their order (`ON DELETE RESTRICT`). Message bodies are purged 90 days after creation; metadata (event, recipient address, reply-to address, sender name, status, provider id, timestamps) is kept up to 3 years (ADR-0025 §10). Erasure follows AUT-371 / AUT-374. |
| LandingDemoAccessRequest | Retention-bound (AUT-547) | No delete API. Stores minimal landing-form fields with consent timestamp. Purged with tenant purge; operational retention follows notification/audit policy (typically ≤3 years metadata, bodies per outbox rules). |
| LandingDemoSignInGrant | Retention-bound (AUT-547) | Evidence of issued magic-link grants. No delete API; removed with tenant purge or when superseded (`invalidated_at`). |
| PublicRateLimitCounter | Ephemeral | Fixed-window abuse counters for public endpoints. Rows expire by `expires_at`; daily cleanup deletes expired windows. |
| WorkshopTask | Conditional | Allow only when parent `WorkshopOrder` is not `INVOICED`, no linked invoice exists yet on the order, no `LaborEntry` records exist for the task, and **no child line has a `PartsReservation` or inventory activity**. |
| WorkshopTaskLineItem | Soft-cancel after operational history | Hard delete forbidden once any `PartsReservation` or `InventoryTransaction` exists. Consumed > 0: leftover-release shrinks `quantity` to consumed, status `CONSUMED` (still billable). Consumed = 0: status `CANCELLED`. Keep the row so reservations retain `workshop_task_line_item_id`. `replaceTaskLineItems` must not `deleteMany` operational lines. A line referenced by a `WarrantyClaimLine` cannot be hard-deleted either: the database foreign key (`RESTRICT`) refuses the delete, so the line replacement and the task delete fail with 422 and the generic related-record message. While the claim is `DRAFT`, remove the line from the claim first; once a claim has left `DRAFT` its lines stay on the order for the audit trail. |
| WarrantyClaim | No (close instead) | Retained for the audit trail and the OEM reference; no delete API. Status runs `DRAFT` → `SUBMITTED_EXTERNALLY` → `APPROVED` or `REJECTED` → `CLOSED`. `CLOSED` can be reached from every status, and it is terminal. Type, complaint, cause/correction, lines and claimed amount are editable only in `DRAFT`; external reference and decision fields stay editable until `CLOSED`. Every change is written to the audit log. |
| WarrantyClaimLine | Owned by claim | Added and removed only while its claim is `DRAFT`; cascades with the claim, never deleted after submission. Each line snapshots the order line (type, item number, description, quantity, unit price, net amount) when it is attached; lines that stay on the claim keep their snapshot. References `WorkshopTaskLineItem` with `RESTRICT`. A line may belong to one claim that is not `CLOSED` at a time. Cancelled part lines cannot be attached or submitted. |
| InspectionTemplate | Conditional | Cannot delete if any `WorkshopInspection` references it; deactivate or supersede it instead. |
| InspectionTemplateItem | Conditional | Cannot delete if any `WorkshopInspectionItem` references it; change future template versions instead. |
| WorkshopInspection | Conditional | Cannot delete after the parent order is completed; before completion only manager-controlled void/delete flows should be allowed. Order-level reception checklists linked to a completed `WorkshopCheckIn` cannot be mutated (AUT-563). |
| WorkshopInspectionItem | No direct delete | Managed by the parent `WorkshopInspection` lifecycle and should not be deleted independently after completion. |
| WorkshopCheckIn | Conditional | One reception check-in per workshop order (AUT-385 / AUT-555). `DRAFT` rows may expire under operational retention; `COMPLETED` evidence is immutable in v1. Parent `WorkshopOrder` hard delete is blocked while a row exists (`RESTRICT`). Tenant purge removes check-in media (`WorkshopMedia.purpose` `CHECK_IN` / `CHECK_IN_SIGNATURE`) before the check-in row. |
| WorkshopMedia | Conditional | Cannot delete after the parent order is completed; before completion, only failed or unattached media may be removed by mechanics, otherwise manager-only. Check-in evidence uses `purpose` `CHECK_IN` or `CHECK_IN_SIGNATURE` with optional `check_in_id`; mechanic finding queries ignore those purposes (AUT-538 unchanged). |
| WorkshopVoiceNoteDraft | No direct delete | Immutable audit-support record for voice-note transcription/translation acceptance history; status transitions (`PENDING` -> `ACCEPTED`) only. Records may be removed only by parent `WorkshopTask` cascade deletion. |
| VoiceNoteRateLimit | No API delete | Ephemeral per-mechanic voice-note upload counter. Rows expire by TTL window and cascade-delete with `Tenant` or `Employee`. |
| LaborEntry | No | Immutable audit trail of mechanic time intervals; never hard-deleted through the API. The nightly close-out job may set `ended_at` and `pause_reason = AUTO_SHIFT_CLOSE` on open entries, but does not delete records. |
| InvoiceSequence | No | Numbering integrity record; never deleted. |
| VehiclePurchase | Draft-only | Allow only in `DRAFT` with no `VehicleLedgerEntry` and `status != RECEIVED`. Received purchases are financial/stock history. A `TRADE_IN` purchase (AUT-443) is owned by its `VehicleSale`: it is created, edited and removed only through the sale's trade-in endpoints while the sale is `DRAFT`; cancel and generic delete/patch are refused, and `VehicleSale.trade_in_purchase_id` is a `RESTRICT` foreign key. |
| VehicleSale | Draft-only | Allow only in `DRAFT` with no linked `Invoice`. Invoiced sales are financial documents. A draft sale may hold one trade-in (`trade_in_purchase_id`); removing it unlinks the sale first and then deletes the draft trade-in purchase. |
| VehicleLedgerEntry | No | Immutable vehicle cost/movement audit trail; never deleted through ordinary APIs. |
| LaborCategory | Conditional | Allow only when no `LaborOperation` references it, no child categories exist, and it is not `CatalogProviderSettings.default_labor_category_id`. `WorkshopTaskLineItem.labor_category_id` uses `ON DELETE SET NULL` (hourly/cost rates are snapshotted on the line). |
| LaborOperation | Soft-delete only | Set `is_active = false`; hard delete is not allowed through the API. |
| Employee | Soft-disable preferred | Set `is_active = false`. Hard delete returns `409` if `WorkshopOrder.mechanic_id`, work records (`WorkshopTask`, `WorkshopMedia`, `WorkshopVoiceNoteDraft`, `LaborEntry`), HR records (`AttendanceEvent`, `LeaveRequest`, `EmployeeLeaveBalance`), or retained `InspectorEvidenceRevision` rows reference this employee. `EmployeeWorkSchedule` rows cascade on employee hard-delete — not a separate 409 reason. |
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
| LegalEntity | Conditional | Preserve existing site guards; additionally block hard deletion while Invoice, CreditNote, AccountingExport, Payment, FiscalReceipt, FiscalRegister, or a used accounting profile references it. |
| Invoice (version 2) | No | No status-only cancellation as a financial reversal. Issue a separate numbered credit; retain original snapshot, number and fiscal status. |
| CreditNote | No | DRAFT may transition to VOID without a number. FINALIZED and VOID are retained; no hard-delete endpoint. |
| CreditNoteItem | Draft-parent edits only | Draft line replacement allowed; finalized/void lines retained. No independent deletion endpoint. |
| CreditNoteSequence | No | Numbering integrity record; never reset/recycle consumed numbers or delete through ordinary APIs. |
| LegalEntityAccountingProfile | No after use | Versioned updates; no ordinary delete endpoint once used. Frozen document/run allocations survive profile changes. |
| AccountingExport | No | Retain exact bytes, manifest, frozen profile, checksum and actor/time. No ordinary delete endpoint or short TTL. |

Retention and tenant-purge exceptions require a separate approved policy; this baseline authorizes no historical deletion or snapshot repair.

## AUT-536 — Domain event store

- `domain_events` has no delete endpoint. Each row is written in the same transaction as the committed domain change it records.
- `occurrence_key` is unique per tenant, so one business occurrence yields at most one row. Consumers deduplicate replays by `event_id` (`id`).
- The agent feed orders rows by monotonic `sequence`, not `occurred_at` alone. Cursors are versioned and tenant-scoped.
- Rows are retained for orchestration replay and audit; they follow tenant purge (SQL generator includes the table). No message bodies or customer tokens are stored in the envelope.

## AUT-544 — Domain event consumers (estimate decided internal notice)

- `domain_event_consumer_progress` and `domain_event_consumer_deliveries` have no delete endpoint. Progress and delivery rows follow tenant purge (SQL generator includes both tables).
- `domain_event_consumer_deliveries` is unique per `(tenant_id, consumer_key, domain_event_id)` so a replay cannot create a second internal notice for the same committed event.
- Delivery rows reference `domain_events` with `ON DELETE RESTRICT`; consumer progress is reset only through tenant purge, not through ordinary APIs.

## ADR-0025 / AUT-356 — Notification outbox

- `notification_outbox` has no delete endpoint. Each row is written in the same transaction as the state change it announces, and its foreign key to `workshop_orders` is `ON DELETE RESTRICT`, so an order with notifications cannot be hard-deleted.
- Rows are never deleted to free space. The message body is cleared 90 days after creation, once the row is in a terminal state; the job ships with the sender worker (AUT-356 phase 2). The row keeps its subject, rendered-body hash, recipient address, provider message id and timestamps.
- The tenant purge SQL in `tools/tenant-restore/` deletes outbox rows before orders.
- Erasure after a data-subject request (AUT-371 / AUT-374) restricts access until retention ends. That job is not part of AUT-356.

## ADR-0025 / AUT-354 — Workshop estimates (Kostenvoranschlag)

Retention follows ADR-0025 §2 and §10 as implemented in AUT-354:

- `workshop_estimates` and `workshop_estimate_versions` have no delete endpoint. Their foreign keys to `workshop_orders` are `ON DELETE RESTRICT`.
- At send, a version's snapshot, `snapshot_sha256`, `legal_text_sha256` and PDF archive are written once. They are never rewritten, and a sent PDF is never re-rendered.
- `retain_until` is set at send to 31 December of the document year + 3. When the linked order is invoiced, it moves to 31 December of the document year + 7, in the same transaction as the `INVOICED` status change. It never shortens.
- `legal_hold` blocks any future erasure or cleanup job. Erasure after a data-subject request (AUT-371 / AUT-374) restricts access until `retain_until` and then deletes or anonymises. That job is not part of AUT-354.

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

## AUT-537 — Registration document intake

| Entity | Delete | Rule |
|---|---|---|
| `RegistrationDocumentIntake` | Before `APPLIED` | Hard delete the row and page objects from `UPLOADED`, `QUEUED`, `RUNNING`, `FAILED`, `ABORTED`, and `AWAITING_REVIEW` |
| `RegistrationDocumentIntake` | `APPLIED` | Refuse. Row is audit. Page bytes removed by the byte-purge outbox job |
| `RegistrationIntakeBytePurge` | With intake | Keep row after `processed_at`. Tenant purge deletes object prefix `registration-intakes/{tenantId}/` first, then outbox rows, then intakes |
| `Customer` | Existing | Applied intake does not block delete. `CustomerService.remove` clears holder evidence on linked applied intakes in the same transaction |
| `Vehicle` | Existing | `clearRegistrationEvidenceForVehicle` clears holder evidence when a vehicle delete endpoint runs |
| `Vehicle.national_code` | n/a | Follows vehicle delete rules |

## AUT-527 — Vehicle valuation snapshots

These rules apply when `VehicleValuationSnapshot` exists. This spec PR does not create the table. AUT-551 does.

| Entity | Delete | Rule |
|---|---|---|
| `VehicleValuationSnapshot` | No standalone route | Append-only decision record. No update and no public delete. A new quote is a new row |
| `VehicleValuationSnapshot` | With `Vehicle` | `onDelete: Cascade` only through a vehicle delete that the existing vehicle rule already allows. Vehicle delete stays blocked while a purchase, sale, workshop order, sales order, invoice, ledger entry, or loaner fleet entry exists, so a snapshot cited by that commercial history is not removed early |
| Tenant purge | With the tenant | Delete snapshot rows with the tenant's vehicles. Do not keep a reusable valuation catalog after the tenant is gone |

The snapshot does not reference `VehiclePurchase` or `VehicleSale`, because this feature does not write those prices.

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

