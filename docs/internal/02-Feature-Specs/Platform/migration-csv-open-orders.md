---
title: "Migration CSV 1.1: Open Workshop Orders"
date: "2026-10-19"
module: Platform
status: accepted
linear-project: "incadea Migration"
tags: [feature-spec, migration, workshop]
---

# Migration CSV 1.1: Open Workshop Orders

## Status, purpose and dependencies

Specification baseline requested for `main` by Dejan on 2026-10-19; [AUT-649](https://linear.app/auto-core-platform/issue/AUT-649) defines the files implemented by [AUT-631](https://linear.app/auto-core-platform/issue/AUT-631). It follows the [AUT-646 multi-payer specification](../Finance/split-invoicing-multi-payer.md) and is a normative part of [CSV 1.1](migration-csv-format.md). As an advisor I need to continue genuinely open work with the correct payer, prices and original reference, without replaying source invoices or stock movements.

Acceptance defines the contract, not a shipped importer. AUT-624/638/637, the multi-payer implementation AUT-640, explicit site mappings, and ADR-0031 cutover gates must be ready before production apply. The CSV dictionaries are complete; missing target storage/behavior must block the affected capability rather than silently dropping data.

## Types and common rules

Inherit exact ordered headers, all-column presence, R/O, ISO dates/UTC timestamps, money/qty/hours, opaque external IDs and authenticated tenant/company ownership from CSV 1.1. `pct` is decimal with two fraction digits in 0.00–100.00. External relationships resolve in the same namespace and authorized entity/site; unknown required parents, payer, part or labor references block the order aggregate. No fuzzy name/VIN/plate merge. Task/line IDs are unique across their own files, not merely inside a parent.

Each aggregate consists of one header and all its task/line rows. Dry-run validates the whole graph, payer/price rules and totals before publication. No partial task/order import. The original number is displayed as a legacy reference and retained in a migration receipt; ACP assigns a new native order number once, through its existing tenant sequence. It never reuses the original invoice/order number as a new ACP fiscal number.

## `open_orders.csv`

| Column | Value | Rule |
|---|---|---|
| external_id | R id | OPEN_WORKSHOP_ORDER identity. |
| original_order_no | R text | Original order/quote number, no renumbering of source evidence. |
| original_order_date | R date | <= cutover_date. |
| kind | R enum | ORDER, QUOTE, SCHEDULED. |
| source_status | R enum | OPEN, PLANNED, IN_PROGRESS, COMPLETED_NOT_INVOICED; explicit upstream mapping. |
| partially_invoiced | R boolean | true excludes entire aggregate; see below. |
| site_code | R code | Authorized active site of bundle legal entity, not inferred from switcher. |
| customer_external_id | R id | Auftraggeber; not necessarily payer. |
| bill_to_external_id | O id | Order-level default CUSTOMER payer. |
| vehicle_external_id | R id | Known vehicle; no VIN-only creation. |
| vin_snapshot | O text | Source-present VIN; disagreement with known vehicle blocks until reviewed. |
| odometer | O integer | 0–2147483647 km; see honest fallback below. |
| fuel_level | O integer | 0–100 percent; see honest fallback below. |
| reported_issue | O multiline | Customer report. |
| planned_start_at | O timestamp | Required for SCHEDULED, UTC timestamp. |
| planned_end_at | O timestamp | If supplied, start required and end > start. |
| currency | R enum | EUR. |
| expected_net_total | R money | Sum of all supplied non-TEXT allocation net after both line/order discounts, including INTERNAL. |
| order_discount_net | R money | Source order-level net discount allocated across original operational lines, zero when none; counts each group once. |
| purchase_order_no | O text | External payer/customer PO reference. |
| cost_centre | O text | Source-present fleet cost centre. |
| driver_reference | O text | Minimal necessary business reference, not extra personal profile data. |

QUOTE accepts any of the four source_status tokens solely for **reported SKIP** in v1, retaining raw canonical input/report; do not create a falsely approved estimate or consume a quote/order number. A later quote importer requires a contract revision. ORDER becomes INTAKE even for prior IN_PROGRESS/COMPLETED_NOT_INVOICED; retain source_status in the migration receipt and require advisor review before work/completion. SCHEDULED requires source_status PLANNED and becomes native SCHEDULED. ORDER accepts OPEN/IN_PROGRESS/COMPLETED_NOT_INVOICED; other kind/status pairs error. Native PLANNED does not exist today and must not be invented. No old mechanic sessions, approvals, signatures, completion notifications or planner resource commitments are manufactured.

If odometer is absent, use the linked vehicle's supplied/known mileage, else 0 as an explicitly **unknown placeholder**. Missing fuel_level uses 0 as unknown placeholder, not a statement that the tank was empty. Both defaults warn, retain the missing-value flags, display “unknown — confirm at intake”, and block completion/finalization until an advisor records an actual observation. A real supplied zero is distinguishable. If these flags/guards cannot be persisted, block apply rather than silently invent measurements.

If partially_invoiced is true, exclude header and children as SKIP with original reference and reason. Source work already wholly invoiced is not an open order and must be rejected from this file. Finish partially invoiced orders in the source before cutover (ADR-0031). Such rows still count toward supplied manifest counts/totals; report supplied, skipped and applied totals separately. They never consume native numbers or cause stock effects.

## `open_order_tasks.csv`

| Column | Value | Rule |
|---|---|---|
| external_id | R id | Stable task identity. |
| order_external_id | R id | Exact header parent. |
| task_no | R integer | 1–2147483647, unique per order; presentation order. |
| title | R text | Job title. |
| complaint_text | O multiline | Source-present complaint. |
| work_instruction | O multiline | Source-present instruction. |
| cost_bearer | R enum | CUSTOMER, WARRANTY, GOODWILL, INTERNAL; default for lines. |
| payer_customer_external_id | O id | Task-level default payer; INTERNAL must be blank. |

At least one task per non-skipped order, at least one non-TEXT line per applied order. Imported tasks start NOT_STARTED; source work progress is contextual text/evidence, not a live execution session. task_no duplicates or cross-order child references error.

## `open_order_lines.csv`

| Column | Value | Rule |
|---|---|---|
| external_id | R id | Stable **allocated line** identity. |
| task_external_id | R id | Exact task parent. |
| line_no | R integer | Unique positive presentation order per task. |
| line_kind | R enum | LABOR, PART, FEE, TEXT. FEE covers external services under AUT-631 and maps to existing native FEE; TEXT is narrative, never a PART fallback. |
| labor_operation_external_id | O id | Required for LABOR only. Make-scoped labor identity must already resolve. |
| part_external_id | O id | Required for PART only. |
| description | R multiline | Display text; no executable markup. |
| quantity | R qty | LABOR/PART/FEE >0; LABOR decimal hours, PART actual unit; TEXT 0.000. Group members repeat the same whole operational quantity; it is reconstructed once, never summed across payers. |
| unit | R text | h for LABOR, referenced part.unit for PART, agreed fee unit for FEE, text for TEXT. |
| unit_price_net | R money | Net price per unit/hour; TEXT 0.00. |
| discount_pct | R pct | Whole-line percentage before VAT; TEXT 0.00. |
| net_amount | R money | Exact allocated post-discount net; TEXT 0.00. |
| vat_code | O code | Required for financial line; approved tax-profile mapping for the legal entity, never source numeric VAT enum. |
| cost_bearer | O enum | Same four values; blank inherits task. |
| payer_customer_external_id | O id | Required resolved allocated payer for every non-INTERNAL financial row; INTERNAL/TEXT blank. No importer inference. |
| allocation_group_external_id | O id | Shared original line identity when several allocated rows split one original line. |
| allocation_basis_points | R integer | Financial rows 1–10000, TEXT 0. Ungrouped financial row exactly 10000; grouped positive shares sum exactly 10000. |
| customer_share_pct | O pct | Original goodwill annotation only, required consistently across grouped goodwill/customer rows when known; never applied again. |
| stock_state | R enum | NOT_RESERVED, RESERVED_NOT_ISSUED, ISSUED_BEFORE_CUTOVER; non-PART must be NOT_RESERVED. |
| external_service_reference | O text | Source supplier/approval reference for FEE; no purchasing/payment creation. |
| allocated_order_discount_net | R money | Fixed net order-discount amount assigned to the original operational line, repeated identically across group members, zero for TEXT. |
| payer_metadata_json | R json | Strict object described below; {} means no per-row override, not a fabricated approval. |

LABOR/PART require exactly their reference; FEE/TEXT have neither. Financial unknown references are blocking errors: the older AUT-631 suggestion “unknown → text with warning” is unsafe for priced work and is superseded here. TEXT becomes a nonbillable narrative projection under the task; if no target representation preserves row/order/description, handler capability must block instead of treating it as zero-price PART. FEE consumes no parts stock.

## Payers, allocations, prices and tax

Resolve effective bearer from line then task. **Before producing the canonical rows**, the extractor uses CUSTOMER payer precedence: line > task > order bill-to > one active vehicle BILL_TO party, else one active LEASING party > order customer. Active parties are evaluated at manifest cutover_date with AUT-647 validity; ambiguity blocks, never select first. WARRANTY/GOODWILL uses explicit source line/task payer or the same-tenant make/bearer configuration from AUT-646; missing/ambiguous configuration blocks. The canonical non-INTERNAL financial row must contain the resolved payer; the importer verifies the supplied identity/configuration/eligibility and never substitutes a newly inferred payer. INTERNAL requires null payer and explicit internal-settlement capability, never resolves to the dealership as a customer invoice.

The extractor splits multi-payer originals **upstream into separate allocated rows**, with distinct stable external_id and common allocation_group_external_id. Final native grouping is `(order, cost_bearer, payer)`; matching bearer alone is insufficient. customer_share_pct is documentary metadata, **not** a second split instruction. For a goodwill split the customer's rows use CUSTOMER, the manufacturer's GOODWILL and dealer's INTERNAL. All rows in an allocation group share task, line_kind, catalog reference, whole quantity, unit, unit_price_net, discount_pct, allocated_order_discount_net, vat_code and stock_state. Reconstruct one operational line using that common quantity; do not sum repeated quantities. Groups contain at most three positive basis-point shares summing to 10000 and cannot cross orders or represent unrelated source lines. Ungrouped financial rows have allocation_basis_points 10000 and blank customer_share_pct. TEXT has no allocation group/payer and basis points 0.

For an ungrouped financial line, net_amount = round-half-up(quantity × unit_price_net × (1 − discount_pct/100), 2) − allocated_order_discount_net, which must remain nonnegative. Allocate the source header order_discount_net across original operational lines upstream using AUT-646 largest remainder on post-line-discount net weights; all-zero base requires zero order discount. Count each allocation group once, with stable group/source-line ID tie-break; sum of these unique allocated_order_discount_net amounts must equal header order_discount_net. This preserves fixed discounts without falsifying unit prices or percentages. For a group compute that original whole-line net **once** after both discounts, then allocate its integer cents using allocation_basis_points / 10000 with AUT-646 largest remainder and stable external_id tie-break. Each row's net_amount must equal its computed allocation exactly; their sum must equal the original whole-line net. A grouped row's repeated whole quantity multiplied by price is not its allocated charge. No proportional quantity rounding or invented balancing line is used. Retain zero-cent monetary shares for traceability even with positive basis points, and let AUT-646's explicit no-issuance rule handle a zero-total payer group. All allocated net amounts sum to expected_net_total with no tolerance.

For example, one hour × 100.00 with basis points 3333/3333/3334 repeats quantity 1.000 on all three rows and yields net 33.33/33.33/33.34; operational work remains one hour. For net 0.01 split 3333/3333/3334, the largest remainder gives the cent to the 3334 share; equal remainders use stable external_id. The wire data contains the weights needed to verify either case.

The three header references purchase_order_no/cost_centre/driver_reference are common order defaults only. `payer_metadata_json` has only the optional keys purchase_order_no, cost_centre, driver_reference, claim_reference, approval_reference (each nonempty text <=255 when present) and approved_gross_limit (money string). Unknown keys, null values and control characters fail; omission leaves a key unknown/defaulted. A supplied gross limit requires an approval_reference. This metadata belongs to the row's resolved payer, never another payer. Preserve per-row claim references; each `(order,bearer,payer)` group's effective PO/cost-centre/driver references and approval/limit must be consistent, otherwise block for explicit group reconciliation. Store original source approval context, but require native AUT-646 verification/approval before issuance; importing a reference never manufactures a public approval or signature. An INTERNAL/TEXT row has {}.

Import preserves agreed source net prices/discounts; do not overwrite with today's labor group or retail price on apply. Validate that the approved VAT-code mapping supports later native invoicing; do not claim importing a source tax code certifies an invoice. Tax is not booked/numbered on import. New estimates/invoices later run normal ADR-0023/646 snapshot/rounding/fiscal-lock checks and payer-block rules. Warranty/goodwill approval references and fleet required fields are validated before issuing that payer's invoice, not fabricated by migration.

## Stock, replay and release behavior

Opening stock already reflects the physical cutover inventory. Import creates **no stock reservation, purchase receipt, issue or transfer**. RESERVED_NOT_ISSUED is contextual source evidence, not a recreated reservation; advisor must explicitly reserve/pick later against opening stock. NOT_RESERVED has the ordinary pending-part state. ISSUED_BEFORE_CUTOVER needs an immutable import-consumption receipt linking line/group to source evidence and a dedicated projection as already consumed, so later completion/issuance never consumes it again. It must not manufacture a native ledger entry or reduce opening stock. Unsupported prior-issued semantics block the aggregate rather than downgrading the state.

The shared whole operational quantity is consumed later once per original group; separate payer rows never create separate physical demand. A part allocation cannot change to a different catalog item after a committed stock effect. These guarantees require dedicated AUT-631 tests around grouping and completion, not merely setting an enum directly.

Same accepted aggregate/run replay is no-op and returns its existing native number. Changed input before operational activity may update only through a fresh dry-run with existing update options, full aggregate validation and recorded differences. After native edits, reservation/pick, work execution, approval, completion or any invoice, changed input is conflict; do not overwrite or re-open the order. Absent children never delete native rows. For changed included children, use explicit additive updates; omission cannot imply a new complete replacement. Creation of order/tasks/lines/external mappings and migration receipt is one transaction; failed parents consume no committed sequence number.

## Manifest controls and examples

`counts_by_type` contains all three supplied file row counts. `control_totals.domain_counts.open_orders` is null when header file absent, else full map ORDER/QUOTE/SCHEDULED (including SKIP rows). `open_order_lines` is null when line file absent, else full LABOR/PART/FEE/TEXT map. Their sums equal corresponding row_count. Required `control_totals.open_orders_net` is null iff open_orders.csv is absent, else sum of all expected_net_total (including excluded/quoted aggregates); child financial sums must match each supplied header, including skipped parents, before business filtering. Missing required child files/reference/aggregate mismatch blocks validation; header-only all three with zero total is valid staged empty input.

Synthetic references C001/C002, V001, S1 and OP001 must be mapped in the fixture. All values are fictional. The example represents one original 1-hour, EUR 100 line, split equally; customer_share_pct does not halve it again.

```csv
external_id,original_order_no,original_order_date,kind,source_status,partially_invoiced,site_code,customer_external_id,bill_to_external_id,vehicle_external_id,vin_snapshot,odometer,fuel_level,reported_issue,planned_start_at,planned_end_at,currency,expected_net_total,order_discount_net,purchase_order_no,cost_centre,driver_reference
O001,OLD-W01,2026-10-20,ORDER,OPEN,false,S1,C001,,V001,,10000,50,Service,,,EUR,100.00,0.00,,,
```

```csv
external_id,order_external_id,task_no,title,complaint_text,work_instruction,cost_bearer,payer_customer_external_id
T001,O001,1,Service,,Carry out service,CUSTOMER,
```

```csv
external_id,task_external_id,line_no,line_kind,labor_operation_external_id,part_external_id,description,quantity,unit,unit_price_net,discount_pct,net_amount,vat_code,cost_bearer,payer_customer_external_id,allocation_group_external_id,allocation_basis_points,customer_share_pct,stock_state,external_service_reference,allocated_order_discount_net,payer_metadata_json
OL001,T001,1,LABOR,OP001,,Customer share,1.000,h,100.00,0.00,50.00,VAT20,CUSTOMER,C001,G001,5000,50.00,NOT_RESERVED,,0.00,{}
OL002,T001,2,LABOR,OP001,,Goodwill share,1.000,h,100.00,0.00,50.00,VAT20,GOODWILL,C002,G001,5000,50.00,NOT_RESERVED,,0.00,{}
```

Expected supplied counts 1/1/2, kinds ORDER=1, LABOR=2 and all other keys zero, open_orders_net=100.00. It creates one INTAKE order/one operational labor line with two financial allocations, no invoices, payments or inventory effects. Later native issuance produces two 50.00-net invoices under AUT-646, not four 25.00 shares.

## Database, API, UX and testing

This PR changes only documentation. AUT-631/640 must persist original identity/status, intake unknown flags, frozen prices/order-discount allocations/payer metadata, group/basis-point allocation and one operational quantity, resolved payer and import-consumption evidence; current schema does not supply all of these. Deletion policy and tenant-restore coverage are mandatory for future entities. No new API/OpenAPI/realtime behavior is introduced here; future DTO changes regenerate both contract artifacts. Use existing header/actions/DataTable/StatusBadge and autosave patterns for later UI; show source number/unknown observations without implying native execution history.

Required TDD scenarios: header/task/line schema and mismatch; unknown/foreign references; ORDER/SCHEDULED/QUOTE and partially-invoiced handling; original source vs new native number and no-op replay; exact basis-point/net allocation (penny remainders, three shares and repeated whole quantity), two same-bearer different payers, goodwill not double split, internal no invoice, stock NOT_RESERVED/RESERVED/ISSUED once only, priced unknown item blocks, zero vs absent observations and completion guard, feature flag OFF refusing multi-payer apply, post-activity changed replay conflict, no invoices/notifications or native stock effects on import.

No open wire-format decisions remain. Source export coverage, source unit basis and required payer configuration must be proven in rehearsal. Blocked runtime capabilities remain explicit AUT-631/640 release gates, not permission to discard source values.
