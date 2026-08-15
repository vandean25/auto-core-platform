---
title: "Core Entity Relationship Diagram"
date: "2026-04-12"
tags:
  - database
  - schema
  - erd
---

# Core Entity Relationship Diagram (ERD)

This ERD represents the high-level relationships between the major domains in the Auto Core Platform. It abstracts away join tables and audit fields for clarity. 

```mermaid
erDiagram
    CUSTOMER ||--o{ SALES_ORDER : places
    CUSTOMER ||--o{ WORKSHOP_ORDER : requests
    CUSTOMER ||--o{ VEHICLE : owns
    CUSTOMER ||--o{ INVOICE : billed_to
    CUSTOMER ||--o{ VEHICLE_PURCHASE : sells_used_car
    CUSTOMER ||--o{ VEHICLE_SALE : buys_stock_car
    
    VEHICLE ||--o{ WORKSHOP_ORDER : serviced_in
    VEHICLE ||--o{ SALES_ORDER : referenced_in
    VEHICLE ||--o{ VEHICLE_LEDGER_ENTRY : costed_by
    VEHICLE ||--o{ VEHICLE_PURCHASE : received_as
    VEHICLE ||--o{ VEHICLE_SALE : sold_as
    STORAGE_LOCATION ||--o{ VEHICLE : parks

    VENDOR ||--o{ PURCHASE_ORDER : receives
    VENDOR ||--o{ PURCHASE_INVOICE : bills
    VENDOR ||--o{ VEHICLE_PURCHASE : supplies_used_car

    BRAND ||--o{ VENDOR : supported_by
    BRAND ||--o{ CATALOG_ITEM : manufactured_by
    
    CATALOG_ITEM ||--o{ INVENTORY_STOCK : stored_as
    CATALOG_ITEM ||--o{ INVENTORY_TRANSACTION : tracked_by
    CATALOG_ITEM ||--o{ SALES_ORDER_ITEM : sold_as
    CATALOG_ITEM ||--o{ PURCHASE_ORDER_ITEM : ordered_as
    CATALOG_ITEM ||--o| CATALOG_ITEM : supersedes
    
    STORAGE_LOCATION ||--o{ INVENTORY_STOCK : holds
    STORAGE_LOCATION ||--o{ INVENTORY_TRANSACTION : records
    
    SALES_ORDER ||--|{ SALES_ORDER_ITEM : contains
    SALES_ORDER ||--o| INVOICE : generates
    
    WORKSHOP_ORDER ||--|{ WORKSHOP_TASK : contains
    WORKSHOP_ORDER ||--o| INVOICE : generates
    
    WORKSHOP_TASK ||--|{ WORKSHOP_TASK_LINE_ITEM : consumes
    
    WORKSHOP_TASK_LINE_ITEM }o..o| CATALOG_ITEM : references_part
    WORKSHOP_TASK_LINE_ITEM }o..o| LABOR_OPERATION : references_labor
    
    LABOR_CATEGORY ||--o{ LABOR_OPERATION : groups
    LABOR_OPERATION ||--o{ LABOR_FITMENT : fits_vehicle
    
    MASTER_PART ||--o{ PART_FITMENT : fits_vehicle
    MASTER_PART ||--o| LOCAL_INVENTORY : stocked_as
    
    PURCHASE_ORDER ||--|{ PURCHASE_ORDER_ITEM : contains
    
    PURCHASE_INVOICE ||--|{ PURCHASE_INVOICE_LINE : contains
    PURCHASE_INVOICE_LINE }o..o| PURCHASE_ORDER_ITEM : reconciles

    INVOICE ||--|{ INVOICE_ITEM : contains
    VEHICLE_SALE ||--o| INVOICE : generates
    VEHICLE_PURCHASE ||--o{ VEHICLE_LEDGER_ENTRY : posts
    VEHICLE_SALE ||--o{ VEHICLE_LEDGER_ENTRY : posts
    WORKSHOP_ORDER ||--o{ VEHICLE_LEDGER_ENTRY : capitalizes

    FINANCE_SETTINGS ||--o{ INVOICE_SEQUENCE : guards
    REVENUE_GROUP ||--o{ INVOICE_ITEM : categorizes

    TENANT ||--o{ AUDIT_LOG : scopes
```

## Domain Legends

### CRM (Sales & Operations Front)
- **`Customer`**: The central actor requesting work or buying parts. Types: `PRIVATE` (individual) or `COMPANY`.
- **`Vehicle`**: The VIN master. `inventory_role = CUSTOMER` is a service/CRM car; `USED` (and later `NEW`/`DEMO`) is dealer stock (ADR-0016). Optionally linked to Sales Orders (parts context) and Workshop Orders. Stock cars also link to `VehiclePurchase`, `VehicleSale`, and `VehicleLedgerEntry`.

### Inventory & Catalog
- **`CatalogItem`**: The master product definition. Supports supersession chains (self-referencing relation) for replacement part tracking.
- **`InventoryStock`**: Per-location stock cache. `quantity_on_hand` is an eager cache derived from ledger entries — never mutated directly (ADR-0002).
- **`InventoryTransaction`**: Append-only ledger recording every stock movement. Types: `RECEIPT`, `SALE`, `ADJUSTMENT`, `TRANSFER_OUT`, `TRANSFER_IN`, `RETURN`, `WORKSHOP_CONSUMPTION` (ADR-0002).
- **`StorageLocation`**: Physical warehouse location. Each `InventoryStock` record ties a `CatalogItem` to a `StorageLocation`. Type `vehicle_lot` parks dealer-owned vehicles (not parts bins).

### Procurement
- **`Vendor`**: External supplier. Linked to supported `Brand` entities.
- **`PurchaseOrder`** / **`PurchaseOrderItem`**: Re-stocking pipeline. Goods receipt creates `RECEIPT`-type ledger entries.
- **`PurchaseInvoice`** / **`PurchaseInvoiceLine`**: Vendor billing documents. Lines reconcile against `PurchaseOrderItem` records. Snapshot `unit_cost` and `item_name` at creation (ADR-0004).

### Vehicle Stock (ADR-0016)
- **`VehiclePurchase`**: Acquisition of a used VIN from a `Vendor` or a private `Customer`. Receive posts `VehicleLedgerEntry` type `PURCHASE` and sets `inventory_role = USED`. Not a parts `PurchaseOrder`.
- **`VehicleSale`**: Sale of a stock VIN to a buyer `Customer`. Finalize creates `Invoice` with `tax_mode = MARGIN_SCHEME` (phase A) and posts ledger `SALE`.
- **`VehicleLedgerEntry`**: Append-only vehicle cost/movement ledger (sibling of `InventoryTransaction`, not a parts `TransactionType`). Types: `PURCHASE`, `WORKSHOP_COST`, `ADJUSTMENT`, `SALE`.

### Workshop Operations
- **`WorkshopOrder`** / **`WorkshopTask`**: Service execution documents. Tasks have line items that reference either parts (`CatalogItem`) or labor (`LaborOperation`).
- **`LaborCategory`** / **`LaborOperation`**: Master labor data. Categories group operations for pricing and reporting (max depth 2).
- **`WorkshopTaskLineItem`**: Consumes parts (triggering `WORKSHOP_CONSUMPTION` inventory transactions) or references labor operations.

### Fitment Engine
- **`LaborFitment`**: Maps a `LaborOperation` to compatible vehicles (make, model, year range, engine code). Cascade-deleted with parent operation.
- **`MasterPart`**: Alternative parts catalog with supplier part numbers and OEM cross-references. Coexists with `CatalogItem`.
- **`PartFitment`**: Maps a `MasterPart` to compatible vehicles. Same structure as `LaborFitment`.
- **`LocalInventory`**: 1:1 with `MasterPart`. Tracks quantity, bin location, and pricing outside the ledger-based `InventoryStock` system.

### Finance
- **`Invoice`** / **`InvoiceItem`**: The immutable destination of all billable work. Generated from Sales Orders, Workshop Orders, or Vehicle Sales (ADR-0016). Items snapshot `revenue_group_name` and `unit_price` at the moment of finalization (ADR-0004). Vehicle sales also snapshot margin VAT via `tax_mode`.
- **`InvoiceSequence`**: Singleton counter guarding sequential invoice numbering (`RE-2026-XXXX`). Incremented atomically inside transactions.
- **`FinanceSettings`**: Singleton configuration entity. Holds `lock_date` (ADR-0003), numbering counters, and fiscal year settings.
- **`RevenueGroup`**: Revenue categorization for accounting exports. Linked to `InvoiceItem` via snapshotted `revenue_group_name`.

### Master Data
- **`Brand`**: Centralized master data for vehicle makes (`is_vehicle_make`) and part manufacturers (`is_part_manufacturer`). Linked to `Vendor` (supported brands) and `CatalogItem` (manufacturer).

### Audit & Compliance
- **`AuditLog`**: Append-only business audit ledger recording `before`, `after`, and `diff` snapshots for mutations (`UPDATE`, `DELETE`) on audited tenant business models. Captures actor metadata (`user_id`, `actor_email`, `actor_role`), request correlation ID (`request_id`), IP, and user-agent with deterministic secret redaction (ADR-0015). Never hard-deleted through ordinary application APIs.

---

## References

- ADR-0016: Vehicle Stock Is a Parallel Ledger Domain — VIN master + vehicle ledger; vehicles are not `CatalogItem` stock
- ADR-0002: Ledger-Based Inventory — defines the `InventoryTransaction` taxonomy and eager cache model
- ADR-0003: Fiscal Lock Date — defines `FinanceSettings.lock_date` enforcement
- ADR-0004: Invoice Snapshotting — defines field-level snapshots on `InvoiceItem` and `PurchaseInvoiceLine`
- ADR-0005: Deletion Policy — defines per-entity deletion rules (`docs/deletion-policy.md`)
- ADR-0015: Audit Tracing and Operational Logging — defines the `AuditLog` ledger model, Prisma audit extension, and structured operational logging

