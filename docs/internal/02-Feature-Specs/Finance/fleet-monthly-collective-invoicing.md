---
title: "Fleet Monthly Collective Invoicing"
date: "2026-10-19"
module: Finance
status: accepted
linear-project: "incadea Migration"
tags: [feature-spec, finance, workshop, fleet]
---

# Fleet Monthly Collective Invoicing

## Status and Summary

**Accepted specification baseline — 2026-10-19, Dejan's AUT-651 request.** [AUT-651](https://linear.app/auto-core-platform/issue/AUT-651) specifies the gated successor to [AUT-646's per-order billing](split-invoicing-multi-payer.md). No runtime implementation, migration, enablement or customer/accountant sign-off is authorized by this documentation change. [ADR-0032](../../01-ADR/2026-10-19-collective-workshop-invoice-sources.md) amends source cardinality; ADR-0023's numbering, immutable financial evidence, credit and export principles remain in force.

A collective invoice is **one new fiscal Invoice with one number covering previously uninvoiced allocations from several workshop orders**. It is not an envelope of issued invoices. A monthly statement of existing invoices remains nonfiscal, does not consume a number and cannot rebook revenue or create another receivable. A payer must never receive both an individual and collective fiscal charge for the same allocation.

## User Stories

- Fleet billing staff select a complete, reconciled monthly set of ready work for one payer without issuing each order first.
- Advisors retain each order, vehicle, PO, approval and financial allocation as traceable source evidence.
- Accounting receives one invoice booking per collective invoice and can trace any later credit to the exact original source lines.

## Decisions and eligible scope

The first release supports approved **AT/DE domestic STANDARD/EUR** workshop CUSTOMER allocations, for explicitly opted-in fleet payers. Country-specific accounting export and structured e-invoice eligibility remain separate activation gates; a supported PDF does not imply either capability. Neither WARRANTY/GOODWILL/INTERNAL allocations nor dealer-vehicle sales, sales orders, margin-scheme, legacy documents/open balances, advances, previously committed invoices or settlement expectations enter a collective invoice. Those retain their existing workflows. This is source-backed invoicing, not a new accounting/payment engine.

One collective invoice has the group key `(tenant, legal_entity, persisted_site, payer_customer, currency, country_tax_profile_version, billing_month)`. One group may include one or many complete order/bearer/payer groups; all financial allocations of each selected `(order, CUSTOMER, payer)` group are included, never a partial selection of its lines. Multiple CUSTOMER payers within an order are separate groups under AUT-646. No source allocation can belong to two invoices, including single-order paths.

**One site per invoice** preserves the established `Invoice.site_id` authorization/ownership contract. A fleet across S1/S2 receives separate site invoices, clearly previewed as such; do not label them one cross-site invoice or combine them in a shared PDF. A run may select several authorized sites and payers, but each invoice remains independently site-owned. There is no cross-entity consolidation, including after a legal-form change. No current switcher may rewrite a source's seller/site.

Each candidate requires an active tenant membership and active membership of its persisted active site plus OWNER/ADMIN billing permission; relevant source legal entity/payer must be active and invoice-eligible. `?siteId` or an external payer reference grants no permission. Reauthorize preview, draft, approval, finalization, download and export. Losing access cannot reveal an old run's other-site membership/details. Historic inactive-site access needs its existing separately approved policy; ordinary collection blocks.

## Month, readiness and service evidence

`billing_month` is `YYYY-MM` in the persisted site's frozen IANA timezone. It groups **billing-ready dates**, not a replacement for actual service dates. A new `billing_ready_at` records when a complete payer group first met completed-work, resolved pricing/payer and approval prerequisites for this billing profile; it is immutable evidence for that version. Never derive it later from mutable `updatedAt` or the server clock. Eligibility initially selects ready dates in that month, before the run's recorded cutoff. The source order must be COMPLETED, with no selected allocation committed or claimed elsewhere.

Every allocation also has actual `supply_date_from/to`, ordered and supported by service evidence. Work may span earlier months: preserve each range and set invoice supply range to their minimum/maximum, while labeling the separate billing month honestly. Do not replace an October service date with November simply to group it. The verified country profile enforces its applicable issue deadline from the relevant supply/ready evidence; batching is never permission to defer tax liability or legally required issuance. Missing service dates/deadline evidence blocks the group. An earlier-month ready group missed by a prior run appears as an explicit overdue exception; a user can approve it into a later run with its original ready/supply dates and reason, subject to the same deadline/lock checks. Never silently move it to a newer month or backdate the invoice.

Operators prepare the month after its calendar close; issue date is the actual chosen permissible issuance date in an open fiscal period, distinct from billing month and supply dates. The first release is **human initiated and approved**, not an unattended monthly sender. Country/accountant-approved collection terms and invoice/delivery deadlines are configured before opt-in; there is no universal product assertion that every supply may wait until month-end.

After a source version changes before commitment, eligibility/prices/approvals become stale and require a new preview. AUT-646's existing plan freeze after the first payer commitment still applies: other groups of an already frozen order can be collected only against that same complete frozen version. A group already covered by an invoice, credit or explicit zero-issuance decision is not made eligible again. Source readiness is versioned, not reconstructed for historical invoices or imported approvals.

## Selection, draft claims and atomic commitment

1. **Preview** builds a stable manifest of all requested candidates and exclusions, with source IDs/version hashes, grouping key, counts, individual net/VAT/gross and totals. Distinguish unauthorized data (not exposed) from authorized ineligible groups with actionable reasons. A candidate screen is not a reservation and does not guarantee later finalization. Pagination must cover the whole requested set; the UI cannot claim “all month” after loading only one page.
2. **Create draft** rechecks the preview and acquires exclusive draft claims on every included source allocation, atomically per prospective invoice. Single-order and collective writers use the same allocation locks and uniqueness guard. An existing unnumbered individual draft cannot be silently absorbed; explicitly void/remove that draft through its supported audited command and release its claims first. Committed invoices are never eligible. A source change while claimed requires removal from that draft and new preview, rather than editing behind a printed total.
3. **Approve** records actor/time and the exact manifest/priced draft hash, payer and references. Default maximums are 500 source orders and 5,000 allocation lines per invoice; exceeding them blocks with an explicit size report. A user may explicitly partition into nonoverlapping drafts and approve each; the system never silently chunks a requested single invoice or changes totals. Load/lock-time evidence must prove these bounds before release; they are caps, not measured capacity claims.
4. **Finalize** atomically reauthorizes every source, active entity/site, payer block/restriction, country/tax/export prerequisites, fiscal lock/date and version/approvals. Lock in ADR-0023 order: entity → site → tenant finance settings → sorted source orders → sorted allocations/claims → invoice → tenant/year sequence. Every competing issuance path obeys this order. A source may not be added/removed after approved hash; stale data returns conflict with no number allocated. Freeze source plans as needed, financial snapshot and source links, assign one RE number and mark all selected allocations committed in the same transaction. Either all sources of that invoice commit or none do.
5. **After commit** PDF rendering/delivery/export use the immutable snapshot. A renderer, mail or timeout failure leaves the committed numbered invoice and source coverage intact; retry the same document/bytes, never regenerate a second invoice. A response lost after commit is recovered through durable idempotency lookup. Approval does not mark the invoice paid.

Draft claims have no wall-clock expiry that can free allocations while finalization is in flight. An authorized explicit abandon command locks the draft/allocations, verifies no commitment, audits and releases only those draft claims. Committed links survive credits, feature rollback and run failure forever. Use a database-enforced one-active-claim-or-commit invariant on `(tenant, allocation_id)` across **all** invoice origins; process-local locks, checking one foreign key or two unrelated unique constraints are insufficient. No database query per line; prefetch/validate maps and bounded bulk writes inside the transaction.

Durable keys bind tenant, run/group ID, approved manifest hash and operation. Same key/body returns the same draft or committed invoice; changed body under that key conflicts. Rebuilding a run with a different key still cannot claim already covered sources. A request timeout is not permission to abandon/reissue.

## Runs, failures and order lifecycle

The run is orchestration evidence, not a tax document or revenue row. States are DRAFT → APPROVED → PROCESSING → COMPLETE or PARTIAL/FAILED; DRAFT/APPROVED may be CANCELLED only while no finalization is running and no commitment is undone. Per-invoice entries track draft/approved/committed/failed/released with references. COMPLETE requires every selected entry committed or an explicitly approved no-issuance decision; any excluded/unresolved requested group remains visible and prevents an apparently complete “all month” result. PARTIAL means at least one entry committed and another failed; FAILED means no entry committed. A run with no eligible sources is a recorded empty preview, never a zero-number invoice.

Commit is atomic **per invoice**, not across all payers/sites in a run. Retry only uncommitted failed entries, preserving source coverage and successful numbers. Cancelling or retrying a partially committed run cannot roll back its issued invoices or release their links. If a retry changes membership/money, require a new approval hash and still obey the exclusive-claim rules. An all-site run never sends a combined other-site attachment.

For each source order, AUT-646 completion remains: all nonzero external allocations covered by committed fiscal invoices plus explicit internal settlement, with zero-total groups covered by approved no-issuance evidence. One collective commitment can satisfy groups on several orders. An order still awaiting warranty, another payer or internal settlement remains COMPLETED with derived billing readiness; it is not INVOICED merely because the fleet share was collected. No credit reopens the order or makes a committed allocation billable again.

Collective commitment **does not consume stock** or duplicate labor. Selected work is already operationally completed; link the existing stock/consumption evidence. Existing single-order issue paths must also separate coverage from physical consumption when mixed per-order/collective payers coexist. There is no rollback/restock on fiscal credit or batch cancellation.

## Financial snapshot, references and PDF

Use an explicit new **snapshot version 3 for collective invoices**, retaining v1/v2 readers unchanged. It contains ADR-0023 seller/recipient/site/country/payment/tax/accounting facts plus origin `COLLECTIVE_WORKSHOP`, billing month/timezone, issue/supply dates, immutable source manifest and run reference. Each invoice line references one original priced allocation and its original order/group/line/version, vehicle identity, service dates, frozen net/VAT/gross, revenue/accounting allocation and required PO/cost-centre/driver/claim/approval references. `Invoice.vehicle_id` is null for the collective; every vehicle identity comes from its corresponding source block, not one arbitrary order.

Source multiplicity is represented by join rows and the snapshot, never a synthetic “monthly workshop order”. No `workshop_order_id` is assigned as a representative source. Sales-order and vehicle-sale links remain null for this origin. The PDF groups source rows by original order and vehicle with per-source subtotals; then shows tax buckets and final total. The document title/number represents exactly one invoice. Mandatory source/reference detail is part of the retained invoice PDF; a changeable external appendix alone cannot supply fiscal evidence. No one-source resolver may silently return the first source.

There is one payer identity/address/language/payment term set per invoice, snapshotted at approval and revalidated before commit. Required PO/cost-centre/driver references may differ by order and remain attached to their source blocks. If a payer contract requires **one** PO/cost centre per invoice, include that field in the grouping partition and show the additional groups before approval, rather than overwrite it or discard other source references. This is a refined partition of the base key, not another invoice for an already billed allocation. The grouping policy and payer opt-in version are frozen; a changed payer profile invalidates the draft, never committed evidence.

Amounts come from AUT-646's approved priced source allocations. Preserve allocated net/tax/gross cents and original line identities exactly. **No second monthly discount, repricing, VAT recomputation from the grand total or per-order subtotal recomputation.** Existing line/global discounts were allocated upstream. Additional monthly rebate requests need their own supported credit/commercial policy and approval; do not silently create negative source lines. Sum line amounts into source subtotals, tax buckets and invoice totals with decimal arithmetic and exact equality. Conflicting source tax/account mappings or unsupported tax profiles block; a renderer/exporter cannot repair them with current master data.

The payer sees only their allocations and necessary source identifiers. Vehicle customers do not automatically receive another fleet payer's prices or PDF. Public links bind recipient and this invoice/version; no order-wide approval token is repurposed for all sources. Contact consent and transactional delivery rules remain effective. Never include internal costs, another payer's share or unrelated driver profile data in appendices/emails/exports.

## Corrections and payments

Credits still reference **one** original Invoice and its immutable invoice-line IDs under ADR-0023. A partial quantity credit can select sources/lines within one collective invoice; cumulative credited quantities/money are checked under the original invoice lock and final remaining cents are exact. Persist source-allocation references on credit-line evidence for per-order reporting, without mutating the original manifest. A single credit may not mix lines from different collective or per-order invoice originals. Full cancellation uses the existing full numbered credit, never editing/cancelling source links or reusing the original RE number. No automatic restock, rebill or new collective eligibility after a credit. A mistaken finalized credit or payer reassignment retains the existing accountant/manual corrective-debit limitation; no credit-of-credit feature is promised.

Bank collection/standing instruction is a settlement mechanism, not a second invoice. The issued collective invoice creates one fiscal receivable in the existing accounting/payment flow; no per-order shadow receivables are generated. Payment applications are linked to that invoice. If a payment covers several existing invoices, use the separately authorized payment-allocation workflow; a monthly statement cannot mark them paid. Source orders do not each receive the entire collective payment amount in KPI queries.

Cash/card settlement, including a later partial payment, follows the legal entity's existing approved fiscal/payment rules and register. Do not sign a fictional cash receipt for an unpaid monthly invoice or treat issuance as payment. A genuine cash/card payment must produce its required timely fiscal evidence through the supported provider or external-register mode, referencing the issued invoice without a second fiscal charge. Retries must not duplicate payment or FiscalReceipt. Before enabling collective invoices with cash/card, prove collective-origin payment/receipt linkage, partial amounts/tax allocation and recovery end-to-end. Until that capability is verified, collective opt-in permits only the proven noncash collection methods and explicitly blocks cash/card settlement through ACP for that profile; an external register is not universally mandatory.

## Numbering, accounting export and period boundaries

Keep the existing tenant/calendar-year `RE-YYYY-NNNN` series and separate CN series, shared across sites/entities. One collective finalization consumes exactly one RE number, no run/order/payer-specific series or imported number. Rollback consumes no committed number; a committed number survives PDF/mail failure and is never reused. Billing December with issue date in January uses the issuance-year numbering convention of ADR-0023; actual December service dates remain in the snapshot. Credits use their own permitted current date/series; no source period is reopened.

Every enabled serializer (DATEV/RZL/BMD or other approved profile) must explicitly support snapshot v3, one document manifest entry per collective invoice and its retained source/line accounting facts. Emit approved postings from frozen allocations/tax buckets exactly once. Do not export the constituent workshop orders or per-order synthetic invoices, and do not export the same header total once per join row. Credits export once at their own date with opposite polarity. Unsupported v3 evidence blocks the complete selected export scope with a reason; no silent exclusion or fallback to the first source. Existing export legal-entity/site authorization and immutable byte/run hash apply.

Revenue KPIs count committed invoice allocations net of finalized credits, not billing runs or source-order totals again. Per-order breakdown follows source allocation/credit evidence; per-site and overall sums reconcile to invoice/credit totals. Payment KPIs use real payments without multiplying them across source joins. Ready/unbilled backlog counts are separate operational measures, not earned fiscal bookings.

Issue date, supply period, VAT liability period and exporter posting date are separate concepts. Do not select one by guessing from billing_month. A profile's accountant-approved posting policy must handle December services invoiced in January, closed supply periods and legal issue deadlines before activation. Existing fiscal lock remains tenant-wide; no source-date override bypasses it.

## Worked examples

Examples are synthetic STANDARD/EUR illustrations at stated rates, not country/export-profile approval.

| Case | Sources | Result |
|---|---|---|
| Same fleet, seller/site/month | Order A net 100.00 / tax 20.00; B net 200.00 / tax 40.00 | One collective RE: net 300.00, tax 60.00, gross 360.00; 2 source blocks, 1 payment balance. No individual A/B invoices. |
| Mixed approved rates | A 100.00 +20.00 VAT; B 50.00 +5.00 VAT | Net 150.00, VAT buckets 20.00 and 5.00, gross 175.00; never apply one rate to 150.00. |
| Existing rounded source cents | A net 0.03 tax 0.01; B net 0.03 tax 0.01 at 20% | Collective 0.06 /0.02 /0.08, not recomputed tax 0.01 on 0.06. Each source has its original rounding evidence. |
| Two sites, same payer | S1 A gross 120.00; S2 B gross 240.00 | Two previewed site-owned invoices; no shared PDF or cross-site download. A user authorized only for S1 cannot collect S2. |
| One order with another payer | Fleet CUSTOMER net100/tax20; warranty net50/tax10; internal net10 | Fleet 120.00 may join collection. Warranty remains per-order 60.00; internal has no invoice. Order INVOICED only after fleet/warranty commitments and internal settlement. |
| Partial correction | Original collection A100/20, B200/40 | Credit half B quantity: net100/tax20/gross120 linked only to B's original line; remaining economic total200/40/240. Original RE stays300/60/360; no A/B re-eligibility or stock return. |
| Partial run failure | S1 invoice360.00 commits; S2 fails payer validation | S1 stays committed/numbered; run PARTIAL, S2 has no number. Retry only S2 after fresh validation, never reissue S1. |
| December work, January issue | A supply Dec20, B Dec28; ready in December; issue Jan3 | billing_month December, supply range Dec20–28, actual Jan3 invoice date and new issuance-year RE; posting/deadline readiness requires approved country profile. No backdating. |
| Cash paid later | Issued collection360.00, later120.00 in-person card payment | One actual120.00 payment/fiscal receipt through the approved flow; remaining240.00. No second360.00 invoice, no duplicate VAT booking from the receipt. |

For the two-source360.00 example, source net/tax/gross sums are exactly300.00/60.00/360.00. A later credit120.00 and actual payment120.00 are different events: economic outstanding after both is120.00 (360 −120 −120), not zero or240.00. Export never records an expected payment as another sale/credit.

## Database Impact and deletion policy

Target design only; no Prisma migration in this ticket:

| Model | Required addition/change |
|---|---|
| Invoice | Explicit origin discriminator; collective snapshot v3; nullable single-source fields only under a validated nonempty collective source manifest. Persist one seller/site/payer. Legacy nullable rows remain distinguishable, not silently upgraded. |
| InvoiceSourceAllocation | Composite tenant-safe invoice/source order/allocation/version links; immutable coverage, ordinal and source financial/supply/reference snapshot. Unique committed coverage per allocation across all origins. |
| InvoiceAllocationClaim | Shared draft/committed ownership guard used by both per-order and collective writers; one active claim/commit per allocation, audited release only before commitment. |
| CollectiveBillingRun / Entry | Scoped month/timezone/cutoff, requested/full candidate manifest, exact approved hash, per-invoice outcome/idempotency/error references; never revenue. |
| FleetBillingProfile | Versioned opt-in per tenant/entity/site/payer, eligible country/method, reference partitioning/terms/deadline configuration; no implied processing consent. |
| Source payer group / allocation | Versioned ready timestamp, actual service range and immutable priced facts; complete source coverage query; no status-only inference. |
| CreditNoteItem / snapshot | Preserve original collective invoice-line/source allocation links; existing one-original credit aggregate retained. |

Existing `Invoice` has a singular workshop relation and a tenant/order unique key; AUT-640 plans per-order/bearer/payer uniqueness. Collective invoices cannot be modeled by simply removing that constraint. Add the origin and coverage join/claims first, retain existing sales/vehicle constraints, and enforce exactly one allowed source shape. A collective has no direct workshop/sales/vehicle-sale FK and a nonempty same-owner source set. A single-order invoice has the existing single source plus coverage for its eligible allocations. Guard these invariants in database-supported relationships/uniqueness and the finalization transaction; do not trust a polymorphic JSON list alone.

Implementation must update `docs/deletion-policy.md`: committed links/snapshots/claim tombstones, approvals and run entries that reference issued documents are retained append-only with invoice retention/holds; no ordinary delete of referenced orders/allocations/configurations. Uncommitted draft claims release under the audited abandon command, not cascade deletion of fiscal evidence. Extend tenant-restore ordering/verification for all new relationships. Reuse invoice/PDF storage generations and approval evidence retention; no new general event-sourcing platform.

## API Contract, UI, realtime and compatibility

No endpoint/DTO/Swagger/OpenAPI change is made here. Implement dedicated preview/create/approve/finalize/abandon commands with version/hash/idempotency semantics above; collection must not masquerade as repeated calls to an existing one-order invoice endpoint. Detail DTOs add origin/source blocks while retaining old single-source fields as null for collective; old clients must explicitly reject unknown origin rather than show an unrelated first vehicle/order. New DTOs regenerate OpenAPI and frontend types.

Read the entire connected flow before implementation: workshop/sales finalizers and draft writers, invoice lists/details/PDF snapshot resolver, credit validators, fiscal payment/receipt adapters, exports, KPI/report queries, MCP reads/proposals and realtime invalidations. All code that follows one workshop FK must handle collective joins or refuse that origin. Unknown snapshot v3 cannot fall back to live source data or one-source rendering.

Use the existing invoice domain UI and standard page headers/actions (top-right), DataTable/StatusBadge for source/outcome rows and exact preview totals. Complex draft edits use 750ms autosave with Saving/Saved/Error; approval/finalize remain explicit versioned actions. Show billing month separately from issue/supply dates, each resulting site/reference partition and any exclusions/size split before approval. No new per-order row “invoice again” path when already covered. Draft removal cannot imply deleting committed invoices.

MCP may read authorized coverage and propose collection; approval/finalization retain existing human-confirmation policy. The new enablement toggle is HUMAN_ONLY, OWNER only, audited, default OFF. Realtime broadcasts committed invoice/order/run outcome changes only to authorized domain subscriptions and invalidates shared query factories; no cross-site event payload or per-line network storm.

## Delivery, rollback and activation gates

1. Deliver AUT-640's allocation/version/coverage prerequisites and the additive claim/origin/source schema, with target cardinality amendment ADR-0032. Preserve old single-order readers/writers behind default-OFF collective flag. Verify existing schema/actual branch before writing a migration; planned specs are not proof of implemented fields.
2. Deploy all updated origin-aware single-order writers/readers, credit/export/payment/PDF paths before collective issuance can be enabled. Existing issued v1/v2 documents are unchanged; no synthetic collective links, supply dates or allocations are backfilled. Existing drafts remain single-order unless explicitly abandoned/recreated through the supported flow.
3. Prove concurrency/isolation/cent conservation, recovery and max-size behavior. Configure payer opt-ins and country/accounting/e-invoice/payment-method profiles. Product owner/accountant signs numerical country fixtures and applicable deadlines. DE structured-invoice obligations cannot be satisfied merely by an ACP PDF; until a required compliant channel is verified, affected payers cannot enable collection. AT register readiness follows the actual payment method, never the word “monthly”.
4. Enable only the verified combinations after Dejan's demo. Default-OFF collective flag is separate from split_invoicing_enabled. Disabling blocks new collective drafts/issuance; committed v3 evidence remains readable/exportable/creditable through retained compatible code. Drain/explicitly abandon uncommitted drafts under locks; never roll back to a binary that ignores committed source coverage. If origin-aware code is unavailable, stop all affected issuance until a forward fix rather than permit duplicate per-order billing.

No automatic migration of already issued per-order invoices or monthly statements into collective invoices. There is no implementation ticket automatically executed by acceptance of AUT-651.

## Testing Plan and completion evidence

- TDD eligibility: month/timezone/DST/year rollover, cross-month supplies, overdue deadlines/cutoff, opt-in/reference partitions, completed/priced/approved source versions, foreign tenant/entity/site/payer and revoked membership.
- Concurrent single-order vs collective issue and two overlapping runs: exactly one active claim/commit; stable number/idempotent recovery. Draft abandon vs finalize, source edits/other-payer commitment, timeout before/after commit and feature-disable races.
- Two-source/mixed-rate/rounded-cent examples, header discount already allocated once, zero groups, max-size explicit partition, unchanged source tax/account facts, source subtotals = all tax/document totals.
- Immutable v3 source/vehicle/service/reference/PDF facts after master-data changes; payer-only permissions and S1/S2 leak tests; unknown-origin/old-client fail-closed behavior.
- Partial/full credit retains one original, caps original quantities/remaining cents and traces selected source; no source reopening, restock, rebill or duplicate revenue/payment count.
- Per-invoice atomic commit and PARTIAL run recovery; failure does not renumber a successful entry or hide unresolved requested sources. Unsupported export v3 blocks whole selected scope; supported serializers include exactly one invoice/credit manifest entry.
- December/January profile fixtures, actual later cash/card and partial-payment receipt replay, bank collection expectations vs real payment, country e-invoice/delivery gates, disabled-flag regression for per-order/sales/vehicle paths.
- Migration/tenant-restore/deletion guards and tested forward-only rollback behavior. Runtime code must regenerate contract artifacts and pass applicable CI; this documentation PR only checks content, links and numerical examples.

## References and open questions

No open product/cardinality choices remain for the initial scope; accountant/country/provider/load evidence is explicitly required before enabling it. This is a specified design, not independent legal/tax certification.

- [ADR-0032](../../01-ADR/2026-10-19-collective-workshop-invoice-sources.md); [ADR-0023](../../01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md); [AUT-646 multi-payer baseline](split-invoicing-multi-payer.md); [AUT-649 open-order contract](../Platform/migration-csv-open-orders.md).
- [AUT-651](https://linear.app/auto-core-platform/issue/AUT-651) owns this spec; [AUT-640](https://linear.app/auto-core-platform/issue/AUT-640) remains the per-order implementation prerequisite, not an authorization to implement collection.
- Primary country references checked 2026-10-19: [AT invoice particulars](https://www.usp.gv.at/themen/steuern-finanzen/umsatzsteuer-ueberblick/weitere-informationen-zur-umsatzsteuer/vorsteuerabzug-und-rechnung/formerfordernisse.html) requires actual service date/period; [DE §14 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html) governs invoice particulars/electronic-invoice eligibility. These references do not approve a particular ACP country/export serializer.
- [BMF electronic receipts](https://www.bmf.gv.at/public/top-themen/Elektronischer-Beleg-und-digitale-Belegmitnahme-.html) associates creation/signing with the actual cash payment. This supports separating fiscal payment evidence from an unpaid monthly invoice; exact method/profile behavior still requires current specialist/provider validation.
- ACP inspection: `apps/core-api/prisma/schema.prisma` (Invoice/InvoiceItem/CreditNote/Payment/Site/AccountingExport); invoice source resolvers and `apps/core-api/src/finance/accounting-export/`. No proprietary source-system definitions are part of this contract.
