---
title: "Split Invoicing and Multiple Payers"
date: "2026-10-19"
module: "Finance / Workshop / CRM"
status: accepted
linear-project: "incadea Migration"
tags: [feature-spec, finance, workshop, migration]
---

# Split Invoicing and Multiple Payers

## Status

Accepted as the specification baseline requested for main on 2026-10-19. This is the documentation deliverable for [AUT-646](https://linear.app/auto-core-platform/issue/AUT-646); [AUT-640](https://linear.app/auto-core-platform/issue/AUT-640) owns implementation. Acceptance does not certify implementation, accountant approval, demo verification, flag enablement or production cutover. Those remain separate gates. This document overrides AUT-640's earlier single-customer-payer draft and its per-legal-entity numbering wording; [ADR-0023](../../01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md) remains authoritative for fiscal documents and tenant/year numbering.

## Summary

A workshop order can allocate work to several identified invoice recipients and to internal consumption. Persist both the business classification (`CUSTOMER`, `WARRANTY`, `GOODWILL`, `INTERNAL`) and the resolved payer for each financial allocation. Group invoices by order, cost bearer and payer. Keep physical work and stock consumption separate from financial allocation so splitting one repair never consumes parts twice. This is a dealer-workflow prerequisite of [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md), including [AUT-649](https://linear.app/auto-core-platform/issue/AUT-649)'s canonical open-order contract and AUT-631's later importer.

Only workshop orders are in v1. Sales orders and dealer vehicle sales keep their existing source cardinality. Reuse legal invoice snapshots, per-document credits, fiscal locks and approved accounting profiles. No payment ledger, insurer claims integration or monthly collective invoice is introduced here.

## User Stories

- As a service advisor, I assign covered service to a leasing company and extras to the driver, with separate approvals and invoices.
- As a warranty advisor, I bill the configured brand payer at the agreed rate and split goodwill transparently without duplicating work or stock.
- As finance staff, I reconcile every allocated cent to an invoice or an audited internal settlement, and export only issued fiscal documents.
- As migration operations, I supply one resolved payer per canonical allocation and block ambiguous mappings before an open order is applied.

## Product Decisions

### 1. Cost bearer and payer are separate

`cost_bearer` describes why a share exists. `payer_customer_id` identifies the invoice recipient, a same-tenant Customer; it is required on every non-internal allocation and null on INTERNAL. An insurer, fleet company, lessor or importer is a Customer identity when it is the invoice recipient. There is no new INSURANCE or LEASING cost-bearer enum: commercial shares use CUSTOMER with the appropriate payer and contextual claim/contract references. Vehicle parties describe relationships, not authorization or automatic liability.

Staff can set nullable defaults on a task and explicit overrides on its line/allocation. Resolve CUSTOMER by **line/allocation → task → order bill-to → active vehicle BILL_TO → active vehicle LEASING → order customer**. A stored order bill-to already wins over a later vehicle-party change. AUT-638 prefills it from an unambiguous active vehicle party, otherwise from the order customer's direct default bill-to. No recursive bill-to traversal, self-reference or chain longer than one edge. Two eligible parties at the same priority block resolution; never choose by creation time. INSURANCE parties never become default bill-to without explicit selection and documented responsibility.

For WARRANTY and GOODWILL, use an explicit line/task payer override or the active, exact-brand `CostBearerPayer` configuration for that bearer; no fallback to the driver. The task's warranty claim and vehicle make must agree. Missing brand, missing/multiple configuration or a blocked recipient prevents draft generation. An explicit override requires a reason and audit entry. INTERNAL rejects any payer rather than silently discarding one. The resolver validates all references within the tenant; order/site access comes from the persisted order site and active memberships.

Resolve and persist payer, pricing and source of the decision before approval/draft creation; finalization rechecks eligibility but does not silently replace the chosen payer from changed master data. A payer blocked for INVOICING or ALL prevents issuance. Restriction/privacy flags remain effective; a bill-to relationship grants no contact or marketing permission.

### 2. Allocations, pricing and exact cents

An operational line remains the identity for quantity, reservations, actual hours and consumption. Its financial allocations cover exactly 100% of its priced net amount; each allocation has one bearer, one payer (except INTERNAL), stable ID, source-line ID and shared `allocation_group` reference. Unallocated, overlapping, negative or over-100% shares are errors. Up to three shares are supported, including manufacturer/customer/dealer goodwill. Use integer basis points (0–10000, positive shares only), not binary floating point. A normal line has one 10000-basis-point allocation.

Price before splitting: select one agreed source-line labor rate/parts price and discounts, freeze that net amount, then allocate it. WARRANTY/GOODWILL uses the selected configured payer price group; CUSTOMER uses the explicitly agreed fleet/lessor/customer price group and parts discount. When several shares apply to one line, the advisor selects one agreed pricing basis for that entire line; conflicting payer price groups require an explicit approved rate, never different full-value prices on duplicated work. Additional independently priced work is a separate operational line. Reuse existing price-group/discount mechanisms; no date-dependent fleet pricing engine in this slice. No silent repricing of imported allocated amounts.

Round net line amounts half-up to cents after quantity, rate and line discounts. Allocate any order discount proportionally across eligible source-line net amounts before the payer split; allocate cents by largest remainder, ties by stable source-line ID. Apply that same largest-remainder method to each line's net cents across allocations, ties by stable allocation ID. For external allocations, compute VAT from the resulting net cents at the pinned tax rate, half-up, once per allocation; gross is allocated net + tax. INTERNAL stores notional net value and zero invoice tax, with no external gross receivable; tax treatment of internal consumption remains the existing separately approved inventory/accounting policy. Bucket and document totals are sums of external allocation values; never recalculate tax from a document total. The split preview is the authoritative priced order total, including the effect of per-allocation VAT rounding, and must be approved if that changes a previously approved total. Never shift a tax cent without its taxable base/profile evidence. No duplicate application of percentages, discounts or tax at invoice generation or export.

For example, net 100.01 at 20% split equally, with allocation A sorting first: A gets net 50.01, tax 10.00, gross 60.01; B gets net 50.00, tax 10.00, gross 60.00. Their totals are exactly 100.01 / 20.00 / 120.01. One net cent split using A/B/C basis points 3333/3333/3334 goes to C (highest remainder), with A/B monetary shares zero; stable IDs break only equal remainders; retain zero-value allocations for reconciliation but issue no zero-total invoice. Rates, quantities, computed totals and allocation versions are decimal-string evidence in the snapshot.

### 3. Leasing and fleet responsibility

The advisor assigns contract-covered service/wear to the lessor and extras, non-covered tyres or damage to the driver/lessee; vehicle ownership alone never determines coverage. Record lessor approval reference, contract/order number, approved **gross EUR** limit and the approved allocation version. Finalization blocks when the lessor share exceeds the limit or mandatory approval is missing. Staff obtain a revised approval or reallocate the excess to a separately approving payer. They cannot charge it automatically to the driver. Every financial or payer change invalidates the affected approval version.

Fleet invoices require the configured customer's PO/order reference, cost centre and driver reference; requirements are explicit per payer configuration, with tenant-scoped references and conservative text bounds (255 characters, no control characters). Only approved fields necessary for that recipient are printed. Snapshot the agreed labor rate/parts discount and references. Missing mandatory references block that payer's issuance.

Monthly collective invoicing is **out of scope**: v1 issues one invoice per (order, bearer, payer), even for the same fleet payer over many orders. [AUT-651 — SPEC FIRST: Fleet monthly collective invoicing](https://linear.app/auto-core-platform/issue/AUT-651) owns the follow-up. It must decide cross-order source cardinality, supply periods, approvals, document/payment handling and an ADR before enabling aggregation. A monthly report is not a fiscal collective invoice and does not consume a number. Until that follow-up ships, standard invoices retain their existing per-document numbering and applicable RKSV path.

### 4. Insurance: invoice recipient versus payment responsibility

An insurer's remittance is not itself a taxable supply to the insurer. Staff must explicitly choose an accountant-approved responsibility profile. A vehicle INSURANCE party or input-tax-deduction flag alone cannot choose it. No new tax exemption or reverse-charge profile is inferred. Country/tax-profile approval is a release gate for this scenario.

**Ordinary insurer settlement:** the customer remains the recipient of one invoice for the whole repair. Record a non-posting settlement instruction containing claim number, expected insurer contribution and customer deductible; it does not create another Invoice, tax line, receivable or payment. At net 1000.00 + tax 200.00 = gross 1200.00, gross deductible 300.00 means expected insurer payment 900.00 and customer payment 300.00. The one invoice displays the full 200.00 VAT once, the 300.00 deductible and 900.00 expected third-party contribution as payment information. Actual settlement remains in the existing authorized payment/accounting flow; these expectations never mark the invoice PAID.

**VAT paid by an input-tax-entitled customer:** the same single customer invoice remains 1000.00 / 200.00 / 1200.00. For an agreed net deductible 250.00, the customer is expected to pay 250.00 net deductible + the entire 200.00 VAT = 450.00; insurer contribution is 750.00. There is no standalone VAT-only invoice and no second invoice to the insurer for the same supply. Deductible basis (`NET` or `GROSS`) is mandatory; a number without that basis is invalid. These instructions need accountant approval and cannot be exported as extra bookings.

**Genuine separate contractual invoice recipients:** only with recorded evidence that different priced allocations are properly invoiced to different recipients may the order use ordinary CUSTOMER allocations to insurer and customer. Example at 20%: insurer allocation net 750.00 / tax 150.00 / gross 900.00; customer allocation net 250.00 / tax 50.00 / gross 300.00. Two invoices together contain tax 200.00 exactly once. Each shows only its own tax/base, claim reference, and a non-additive note stating the agreed gross customer deductible 300.00 and that the other allocation is separately billed. Do not print the entire repair as a second payable total. This model cannot represent the VAT-only payment case above. Unsupported responsibility or tax profiles block issuance; they do not fall back to a two-invoice workaround.

### 5. Warranty, goodwill and internal work

WARRANTY/GOODWILL payer configuration is per tenant, exact brand and bearer, with one active payer and optional labor price group. A warranty claim reference is required where coverage is claimed; validation checks its order, vehicle and applicable lines. Existing warranty claim print/export remains separate from invoices. For three-way goodwill, manufacturer = GOODWILL, customer = CUSTOMER, dealer = INTERNAL. The source pricing basis and approval cover all three shares.

INTERNAL creates an immutable settlement summary with stable internal ID, actor, timestamp, reason, source allocation IDs, net cost and notional allocated value. It never receives an RE/CN number, becomes an Invoice, appears as external turnover, or enters invoice accounting export. An OWNER/ADMIN with active site access explicitly confirms internal settlement; zero-value or remaining internal work is never silently considered settled. Parts consumption uses the existing append-only inventory ledger with an internal-use reason and source allocation linkage. If consumption was already posted operationally, settlement only links it; it does not deduct stock again. Financial allocation never multiplies operational quantity.

Internal labor/parts costs and notional value are reported in separate internal-cost/workload KPIs. Revenue KPIs count only committed external invoices, net of finalized credits, grouped by frozen bearer and payer; never count the whole order and its invoices again. Estimated insurer contributions are not revenue events.

### 6. Lifecycle, partial readiness and corrections

Do not introduce a partially-invoiced WorkshopOrder status in v1. Orders keep their existing operational transitions and remain COMPLETED while some groups are unresolved. Additional derived fields expose group counts and readiness. Draft generation requires completed eligible work, an approved allocation version and valid payer details, but one payer's missing approval need not prevent another fully ready group from being generated/finalized. Each selected group finalizes atomically under its own invoice; a failed group remains uncommitted and consumes no number. Generation and finalization are durably idempotent by tenant/order/group/version/request hash, including concurrent requests.

An order becomes INVOICED only when every nonzero external allocation is covered by a legally committed invoice (FINALIZED/ISSUED/PAID under existing source rules) and every internal allocation has an explicitly confirmed settlement. No payment requirement is added to that transition. A fully internal order can become INVOICED only through that settlement completion guard. Zero-total external groups are explicitly recorded as no-issuance with approval evidence and count as covered; they are never quietly dropped. No synthetic invoice or sequence number is created for them.

Freeze the allocation plan when the first group commits. Remaining groups can complete against that frozen version; staff cannot change payer, bearer, price, quantities, discounts or shares of the committed plan, reopen it by crediting, or add new work to it. Additional work uses a new order. This avoids ambiguous partial reallocation. Before any group commits, changing the plan invalidates its drafts/approvals through guarded versioning. Reject stale generation/finalization with a version conflict.

Retain at most one invoice per (tenant, workshop order, bearer, payer); do not use a non-cancelled filter to recycle a group after a credit. Committed version-2 invoices are corrected by ADR-0023's separate CreditNote aggregate, never status-only cancellation or destructive replacement. Partial quantity credits and full credits use original allocation snapshots, remaining quantities and exact remaining cents; they never restock or reopen work. Each original invoice is corrected independently; no mixed-original credit. Payer changes after commitment are unsupported in v1: preserve the original, use the accountant's audited correction procedure, and deliver a separately reviewed corrective-debit/rebilling workflow before promising reassignment. No automatic new invoice after full credit.

Credits require a qualifying ACP version-2 original. Imported LegacyDocument is read-only evidence and never a fabricated Invoice predecessor. AUT-629 legacy history, AUT-630 open balances and original source numbers remain outside ACP sequences and accounting exports. A future correction of a legacy original needs its own validated issuance workflow under ADR-0031.

### 7. Recipient documents and permissions

Staff see all groups only with access to the persisted order site. Each payer sees its own share on estimates, approval view and invoice PDF; the vehicle customer sees their own share only. Public approval tokens are bound to one recipient, one allocation version and approved amount. Do not reuse an order-wide token to reveal other payer prices, internal cost/rates, insurer remittances or third-party personal details. Third-party invoices are not attached to the vehicle customer's communication by default. Internal summaries are staff-only.

Snapshot `Rechnungsempfänger`, `Auftraggeber`, necessary vehicle identity, claim/approval reference, cost bearer, resolved payer identity, priced allocation and required PO/cost-centre/driver fields. Minimize personal details for corporate recipients; the operational customer's full contact record is not automatically printed. Payment terms, language and delivery contact come from the chosen payer under AUT-638 and are frozen; required contact permission checks still apply. Approval of one payer never approves another payer's extras. Existing estimate/communication feature flags and evidence retention remain in force.

### 8. Accounting, numbering and RKSV

Each external invoice freezes ADR-0023 seller/site/country/account allocations plus bearer/payer and allocation identifiers. Export reads committed snapshots, includes each invoice/credit exactly once at its own date and excludes internal summaries, no-issuance groups, approval limits and settlement expectations. Unsupported or legacy fiscal evidence blocks the selected export scope; never silently emit a partial export. A payer split does not authorize a new accounting profile.

Use the existing tenant/calendar-year RE series, shared across sites and legal entities; retain the separate tenant/year CN series. No new bearer/payer/brand/entity counters, imported numbers or resets. Persist seller/site from the source order, never from the current switcher. Apply fiscal lock, active site/entity, seller completeness and membership checks with ADR-0023's lock order (legal entity → site → finance settings → order/source → invoice → sequence; credit also locks the original). Only after all checks and snapshot creation succeeds does the same transaction allocate a number.

Each issued invoice uses the legal entity's applicable RKSV/payment behavior under existing approved flows. Invoice splitting never creates a fictional cash receipt or signs a noncash expectation. ACP's provider/register readiness and any external-register mode remain AUT-634 cutover gates. No monthly settlement workaround bypasses them.

### 9. Migration contract consumed by AUT-649

Canonical `open_order_lines.csv` carries already-resolved financial rows: one cost bearer and at most one payer reference per row, distinct stable `external_id`, common `allocation_group_external_id` for shares of the same original operational line, and explicit allocated money. Non-internal rows require one `payer_customer_external_id`; INTERNAL requires blank. Optional `customer_share_pct` is informational source annotation only: it never multiplies the row quantity, price or already allocated money and never drives another split. No comma-delimited IDs, multi-payer cell, guessed payer or percentage that is applied again in ACP. Open-order data has no issued invoice number or fiscal posting.

The extractor expands a source goodwill line into CUSTOMER, GOODWILL and optional INTERNAL allocated rows **once**, with amounts conserving its agreed net value and tax rules above. AUT-649 defines the exact columns and shared operational quantity/consumption reconstruction. Its importer must reconstruct one operational source line plus financial allocations for a group; summing each share as a fresh physical part is forbidden. Same group must agree on order/task, item, currency, pricing basis and operational quantity; malformed/incomplete or inconsistent grouping blocks the aggregate. Canonical allocation rows do not ask the target resolver to infer a different payer; it verifies the supplied result and eligibility.

References resolve by `(tenant, source_system, external_id)` against Customer mappings in the same company namespace. Missing/foreign/restricted-without-permission payer, ambiguous configuration or absent split capability blocks apply with an actionable row/field error. There is no fallback to all-CUSTOMER import while the flag is off. Importing open orders does not post consumption again, finalize invoices, consume RE/CN sequences or alter imported opening stock. AUT-631 owns application and reconciliation; AUT-649 owns the dictionary and conservation checks, AUT-640 the target capability.

Historical AUT-629 documents use `CUSTOMER`, `WARRANTY`, `GOODWILL`, `INTERNAL` only when explicitly known from upstream evidence; they are plain read-only classifications, never commands to issue split invoices. Preserve an unfamiliar historical source label as bounded display text through AUT-650's explicit history-label field; no fabricated enum mapping. Open-order enums must use the exact four canonical tokens and reject unknowns. No proprietary source IDs, schema names, source excerpts or real pilot identity enter repository artifacts; fixtures are synthetic.

### 10. Feature flag and release gates

`FinanceSettings.split_invoicing_enabled` defaults false. Only an authenticated human OWNER may change it through finance settings, with actor/time/old/new value/reason audited. It is HUMAN_ONLY: no MCP, API-agent impersonation or proposal auto-approval may toggle it. Payer/bearer edits exposed through MCP remain PROPOSE with existing human approval gates.

Off preserves existing single-payer generation for orders that never entered split mode. Enabling requires schema/contract deployment, successful synthetic end-to-end evidence, accountant-approved country/scenario fixtures, and Dejan's demo invoice check. Disabling blocks entry of new split plans but does not hide or mutate existing multi-payer financial history. Existing frozen split orders retain authorized completion/read/credit paths; reject attempts to send them through the legacy single-invoice route. The toggle must warn about active split work and audit its disposition. No migration/cutover approval follows from this document or from an enabled flag alone.

## Database Impact

### New Tables / Columns (target design, not present capability)

| Table / model | Addition | Nullability / invariant |
|---|---|---|
| FinanceSettings | `split_invoicing_enabled` Boolean | Required, default false; audited human OWNER toggle |
| WorkshopTask | `cost_bearer`, `payer_customer_id`, `warranty_claim_id` defaults | CUSTOMER default; optional payer/claim, same tenant/order |
| WorkshopTaskLineItem | Optional bearer/payer overrides; relation to allocations | Resolve before approvals; physical identity remains unique |
| WorkshopLineAllocation | tenant/order/site/source line, stable group/ID, bearer, payer, basis points, allocated net/tax/gross, version, decision source | Tenant-safe composite FKs; payer required iff not INTERNAL; exact conservation; immutable after first commit |
| CostBearerPayer | tenant, exact brand, bearer, active payer, optional labor price group | WARRANTY/GOODWILL only; one active configuration per tenant/brand/bearer |
| WorkshopOrder | Allocation version/frozen version; approval/reference/limit settings | Guard all writers and auto-save against frozen/stale version |
| WorkshopPayerApproval | Order/version/payer, required references, gross limit, evidence/actor/time | Append-only approved evidence; cannot approve another group/version |
| InternalSettlement | tenant/order/site, allocations, cost/value snapshot, actor/time/reason | One confirmed settlement per frozen internal group; immutable |
| Invoice / InvoiceItem | Bearer, payer/source allocation/group references in immutable snapshot; structured FK linkage | Same tenant/site/order, one allocation covered once |

Insurance expected contributions are non-posting structured order/invoice-snapshot information, with claim, responsibility profile, deductible basis, expected amounts and approval evidence. They do not create a payment table. Fleet required-reference flags and the selected price group/parts discount reuse customer/configuration structures where available; AUT-640 adds only missing bounded fields. AUT-638 and AUT-641 own bill-to/vehicle-party prerequisites rather than duplicate relationships here.

### Modified Tables and migration

The inspected schema still has `Invoice` unique `(tenant_id, workshop_order_id)` and singular workshop invoice relation; no CostBearer/payer allocation support is present. AUT-640 needs an additive expand phase and a controlled constraint/cardinality transition, with rollback/old-client handling. Add grouping uniqueness `(tenant_id, workshop_order_id, cost_bearer, customer_id)` for workshop invoices, composite tenant-safe FKs and indexes on order/site/payer and source allocation. Nullable legacy linkage is not permission to issue an unowned new invoice. Preserve sales-order and vehicle-sale uniqueness.

Existing committed invoices/snapshots remain unchanged; technical defaults classify their existing order relationship without fabricating financial allocation evidence. Existing drafts must be revalidated/recreated before entering split mode. New single-payer orders have one CUSTOMER allocation. Never backfill brand payer, VAT, approvals, source allocation amounts or internal settlement from current master data.

This crosses Workshop, Finance and CRM plus migration/communication, so it is high risk. Deliver prerequisites first (AUT-638/641 and legal-invoice support), then allocation/flag schema, then generation/snapshots, then recipient views/import integration. Keep AUT-640 in the serial schema slot recorded in its issue. A focused ADR amendment for workshop invoice cardinality and allocation invariants must accompany implementation; ADR-0023 numbering/credits remain unchanged.

### Deletion Policy Impact

AUT-640 must update `docs/deletion-policy.md` before enabling the feature. Propose: allocations editable/removable only before plan freeze and only without operational reservation/consumption/claim history; never delete physical lines to replace financial allocations. Approved payer evidence and internal settlements are append-only and block order deletion. Payer/brand/configuration records referenced by allocations or documents use Restrict/deactivation. Draft generation alone does not relax current order/task deletion guards; committed allocations/financial parents and sequence records are immutable. Retention/legal holds of invoices and approvals apply to their linked evidence. This doc-only change makes no claim that those database guards are implemented.

## API Contract Changes

### New Endpoints (proposed AUT-640 contract)

| Method | Route | Request / response | Auth |
|---|---|---|---|
| POST | `/api/workshop/orders/:id/create-invoices` | Expected allocation version, selected group IDs, idempotency key; returns draft `invoices[]`, group readiness/errors and internal summary references; no numbering | Authorized existing invoicing role + active order-site membership; MCP PROPOSE |
| POST | `/api/workshop/orders/:id/internal-settlement` | Frozen version, allocation IDs, reason, idempotency key; confirmed immutable summary and resulting order state | Human OWNER/ADMIN + active order-site membership |

Allocation editing extends existing task/line save commands with explicit expected version and allocation/default payloads; AUT-640 publishes exact DTOs before coding their callers. Payer configuration and flag updates extend existing finance settings APIs under their respective OWNER authorization; flag route explicitly rejects agent/MCP callers. Same key/body retries return the same result; changed body returns 409. Validation failure is 422, inaccessible IDs return the existing non-disclosing 404 behavior, and stale versions are 409.

### Modified Endpoints

| Surface | Change |
|---|---|
| Workshop order/task/line reads | Typed allocations, resolved bearer/payer/source, invoice groups/readiness, internal summaries and version; site-safe nested data |
| Existing `POST /api/workshop/orders/:id/create-invoice` | Keep legacy behavior for eligible flag-off single-payer orders; reject split/frozen multi-group orders with explicit capability conflict |
| Workshop order `invoice` field | Deprecated compatibility field: only populated for exactly one customer-bearer invoice; otherwise null. Never choose an arbitrary first invoice. `invoices[]` is authoritative |
| Invoice finalization and credits | Enforce frozen plan and allocation ownership; same legal-credit API/polarity as ADR-0023 |
| Estimate/public approval DTOs | Recipient-specific allocation snapshot; token cannot select arbitrary payer IDs |
| Finance/KPI/export/MCP reads | Frozen bearer/payer dimensions, no internal summaries in fiscal exports; no new agent permissions |

### OpenAPI Regeneration

No contract artifacts change in this doc-only PR. AUT-640 must regenerate and commit both after DTO/routes change:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

## UX Compliance

Order detail adds payer/allocation editing and an explicit preview showing sum conservation, approvals, remaining groups and internal settlement state. All invoice/settlement/print actions stay top-right; top-left keeps context only. Use existing header typography and `text-slate-500` subtitles. Complex edits auto-save at 750 ms with Saving/Saved/Error plus version conflicts; approvals/issuance/settlement remain explicit commands. Isolated notes use InlineEdit on blur. Monetary previews show currency, VAT and net/gross deductible basis.

Use shared DataTable sortable/searchable rows and StatusBadge for payer groups; row click opens the recipient invoice/detail. No new independent list page or create button is needed. No contextual delete exists for committed groups. Any draft removal uses the permitted existing lifecycle, never an apparent deletion of committed fiscal data. German (de-AT) is the source text; implementation uses the ACP i18n skill and synchronized translations.

Realtime remains on existing workshop order/invoice entities: after transaction commit invalidate their shared query-key factories, group previews and relevant KPI caches. Approval/settlement writes must trigger a parent order update/event. If new child entity events are emitted, AUT-640 must register SUPPORTED_ENTITY_TYPES and the frontend dashboard entity map explicitly. No duplicate factory or polling-only stale state.

## Component Design

| Component responsibility | Location / owner | Purpose |
|---|---|---|
| Order/task allocation editor | Existing workshop order/task UI, AUT-640 | Bearer/payer selection, approved pricing and cent preview |
| Payer-group invoice panel | Existing workshop order detail, AUT-640 | Readiness, draft/final invoice links, explicit internal settlement |
| Recipient estimate/approval renderer | Existing workshop-estimate flow | Show only recipient share and immutable approval version |
| Payer/flag settings | Existing finance settings | Brand configuration and audited human OWNER toggle |
| Invoice PDF snapshot renderer | Existing invoice pipeline | Recipient/commissioner/context and allocated amounts |

## Testing Plan

Future implementation follows Red → Green → Refactor. These are required acceptance scenarios, not claims of tests run for this specification.

### Backend E2E and security

- [ ] Full synthetic customer/warranty/internal flow; exactly two invoices, one internal summary, one consumption, exact totals and guarded final order state.
- [ ] CUSTOMER precedence at every level, equal-priority ambiguity, missing warranty payer, brand mismatch, blocked customer and INTERNAL-with-payer rejection; foreign-tenant IDs and cross-site nested access cannot leak.
- [ ] Largest-remainder ties (100.01 and one cent), three-way goodwill, order discounts, mixed tax rates, zero total groups and decimal precision boundaries; stable replay and no double allocation.
- [ ] Concurrent draft/final commands, stale approvals, rate/reference/limit changes, over-limit lessor, one ready and one blocked group, internal-only order and freeze-after-first-commit.
- [ ] Duplicate idempotency keys, changed request hashes, failed snapshots/transactions consume no number; existing tenant/year sequence rollover and sales/vehicle uniqueness regressions.
- [ ] Fiscal lock/site/entity/member races obey common locks; per-invoice full/quantity credit caps and last cents; no payer rebilling, inventory return or fabricated legacy original.
- [ ] Insurance one-invoice deductible/VAT-only cases issue/export one tax amount only; separate-recipient case totals two approved allocations; unsupported profile blocks.
- [ ] Flag OFF single-payer regression, OWNER-only human toggle with audit, MCP rejection/PROPOSE gating, authorized completion after disabling and no split-import fallback.
- [ ] Imported allocation group reconstructs physical work once; consistent company namespace/payer mappings, changed replay, no sequences or stock effects on open-order apply.
- [ ] KPI/export includes issued invoices and credits once by frozen payer/bearer; excludes internal/no-issuance/settlement instructions and blocks unsupported fiscal evidence.

### Frontend, documents and release evidence

- [ ] Each recipient sees only their share, including public-token tampering and unauthorized invoice links; archived snapshot remains stable after payer changes.
- [ ] Auto-save conflict/error indication, top-right actions, DataTable/StatusBadge and German/English text verified in browser.
- [ ] PDF snapshots for leasing references, fleet requirements, warranty, goodwill and both insurance responsibility models; accountant-approved fixtures before activation.
- [ ] Demo review by Dejan with examples below before human OWNER enables the flag. OpenAPI/types, appropriate backend/frontend checks and CI must pass on implementation.

## Worked Examples (synthetic EUR, standard 20% VAT)

| Scenario | Allocation | Net | VAT | Gross / outcome |
|---|---|---:|---:|---|
| Customer + warranty + internal | CUSTOMER, driver | 100.00 | 20.00 | 120.00 customer invoice |
| Same order | WARRANTY, brand payer | 200.00 | 40.00 | 240.00 warranty invoice |
| Same order | INTERNAL, no payer | 50.00 notional | No external tax | 50.00 internal notional value; separate actual cost snapshot |
| Goodwill 50/50 on one 100.00 net line | CUSTOMER | 50.00 | 10.00 | 60.00 |
| Same line, second allocation | GOODWILL, brand payer | 50.00 | 10.00 | 60.00; one physical work line |
| Leasing service | CUSTOMER, lessor | 300.00 | 60.00 | 360.00, approval limit 360.00 |
| Driver extras | CUSTOMER, driver | 80.00 | 16.00 | 96.00; separate driver approval |
| Insurance, ordinary settlement | CUSTOMER, repair customer | 1000.00 | 200.00 | One 1200.00 invoice; expected insurer 900.00 + customer gross deductible 300.00 |
| Insurance, customer pays VAT | CUSTOMER, repair customer | 1000.00 | 200.00 | One 1200.00 invoice; expected insurer 750.00 + customer 450.00 (250.00 net deductible + 200.00 VAT) |
| Insurance, approved distinct recipients | CUSTOMER, insurer | 750.00 | 150.00 | 900.00 insurer invoice |
| Same approved split | CUSTOMER, customer | 250.00 | 50.00 | 300.00 customer invoice; combined VAT remains 200.00 |

The first order reconciles external net 300.00, tax 60.00, gross 360.00 plus internal notional value 50.00. The internal share is not a taxable invoice line or external revenue; operational totals display that distinction rather than adding fictional internal VAT. Actual internal cost is a separate measured value. In the leasing example, adding 1.00 net covered service raises the lessor gross total to 361.20 and blocks issuance until approval or authorized reallocation changes. No fleet collective invoice example is executable in v1; two fleet orders issue two ordinary invoices with separate RE numbers.

## Open Questions, Deferrals and Ownership

All eleven AUT-646 questions are decided in Product Decisions 1–10: payer model (1), leasing/fleet (3), insurance (4), warranty/goodwill/internal (2/5), lifecycle (6), recipient documents (7), export/KPIs (8), migration (9) and flag (10). No unresolved design choice permits implementation to guess at an unsupported scenario.

| Remaining gate / deferred item | Owner and required evidence |
|---|---|
| Fleet monthly collective invoice | [AUT-651](https://linear.app/auto-core-platform/issue/AUT-651), spec-first follow-up for multi-order cardinality, references, numbering/export/RKSV and accountant approvals |
| Corrective debit/rebilling after committed payer change | Existing ADR-0023 corrective-debit deferral; AUT-640 must preserve accountant/support limitation, not implement an ad hoc workaround |
| Accountant-approved insurer/lessor/warranty country fixtures and export eligibility | AUT-640 with the legal-invoicing/accounting-profile owners; blocking release gate |
| Actual split schema, approvals, stock linkage, feature flag and evidence | AUT-640; not supplied by accepted documentation |
| Canonical allocation dictionary and reconciliation; open-order application | AUT-649 and AUT-631 respectively, after AUT-638/641 and AUT-640 capability |
| Vehicle-party/history/open-item schemas and imported evidence | AUT-641, AUT-628/629/630; no new Invoice predecessor |
| DPA, archive, registration and hard-cutover readiness | AUT-634 under ADR-0031; real-data rehearsal remains gated |

## Acceptance Criteria

- [ ] Specification merged with the migration specifications and linked from AUT-640/AUT-646.
- [ ] All eleven issue questions mapped to explicit decisions/deferrals; collective-invoice deferral linked to AUT-651.
- [ ] Worked examples preserve allocated net, tax and physical quantity; VAT-only insurance payments produce no duplicate invoice/VAT.
- [ ] AUT-649 uses the same one-payer-per-row contract and common allocation-group identity without reapplying a percentage.
- [ ] Independent specification review resolved; implementation, accountant, demo, flag and production readiness remain visibly separate.

## References

- [ADR-0023: Legal invoices, credits and accounting export](../../01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md).
- [Legal invoicing and credit notes](legal-invoicing-and-credit-notes.md); [deletion policy](../../../deletion-policy.md).
- [ADR-0031: Migration hard cutover](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md); [canonical migration CSV](../Platform/migration-csv-format.md).
- Inspected target boundaries: `apps/core-api/prisma/schema.prisma` (Invoice, WorkshopOrder, WorkshopTask, WorkshopTaskLineItem) and `apps/core-api/src/workshop/workshop.controller.ts` (existing create-invoice route).

## Linear Tracking

| Field | Value |
|---|---|
| Project | incadea Migration |
| Specification | [AUT-646](https://linear.app/auto-core-platform/issue/AUT-646) |
| Implementation | [AUT-640](https://linear.app/auto-core-platform/issue/AUT-640) |
| Bill-to / parties | [AUT-638](https://linear.app/auto-core-platform/issue/AUT-638), [AUT-641](https://linear.app/auto-core-platform/issue/AUT-641) |
| Open-order contract / apply | [AUT-649](https://linear.app/auto-core-platform/issue/AUT-649), [AUT-631](https://linear.app/auto-core-platform/issue/AUT-631) |
| History / open items | [AUT-648](https://linear.app/auto-core-platform/issue/AUT-648), [AUT-629](https://linear.app/auto-core-platform/issue/AUT-629), [AUT-630](https://linear.app/auto-core-platform/issue/AUT-630) |
