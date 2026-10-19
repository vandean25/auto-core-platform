---
title: "Migration CSV 1.1: Legacy Documents and Open Items"
date: "2026-10-19"
module: Platform
status: accepted
linear-project: "incadea Migration"
tags: [feature-spec, migration, finance]
---

# Migration CSV 1.1: Legacy Documents and Open Items

## Status and Summary

Specification baseline requested for `main` by Dejan on 2026-10-19, tracked by [AUT-650](https://linear.app/auto-core-platform/issue/AUT-650). This normative part of [CSV 1.1](migration-csv-format.md) completes `legacy_documents.csv`, `legacy_document_lines.csv` and `open_items.csv` for AUT-629/630. Acceptance does not certify production readiness. [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md) and [ADR-0023](../../01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md) remain unchanged.

As an advisor I need original history without creating another invoice; as accounting I need a dated display of remaining balances without a second settlement ledger. The retained source export remains the archive of record; ACP is an access copy. The private extractor translates to dealer vocabulary outside ACP. No proprietary schema, real customer identity or unrestricted catch-all source payload belongs in these files.

## Common types and ownership

Inherit the CSV 1.1 exact headers, namespace, UTF-8/RFC 4180, raw-file hashes, opaque IDs and tenant authorization rules. Each table is an ordered complete header. R = nonempty, O = blank allowed. `signed_money` is an optional minus followed by the common money lexical form; `signed_qty` similarly uses three decimals. Reject negative zero, overflow and implicit rounding. `pct` is decimal with exactly two places, 0.00–100.00. `json` is a strict JSON cell, no duplicate keys or extra properties; quote it using CSV escaping.

`legal_entity_code` is an external code resolved by the approved company/entity assignment, never a trusted ACP UUID. It must resolve to that bundle's sole legal entity. A historical predecessor entity needs its own bundle/namespace; do not relabel its seller as the successor. `site_code`, when supplied, must resolve within that entity and caller-authorized sites. Tenant-only history must not become visible across unauthorized sites: absent/ambiguous historic site is stored as explicitly unassigned and exposed only through separately authorized migration-history access, never the current site switcher. Until that access policy is implemented, ordinary site lists/downloads omit unassigned history and reconciliation reports its unassigned count.

Unknown historical customer/bill-to/vehicle references are retained as opaque values with unlinked warnings (AUT-629); they never resolve by names across tenants. Required open-item customer resolution instead blocks the affected snapshot. Skipped/anonymized parties are never recreated by history import.

## `legacy_documents.csv`

| Column | Value | Rule |
|---|---|---|
| external_id | R id | Header identity, unique across this file even across document types. |
| doc_type | R enum | INVOICE, CREDIT_MEMO, SERVICE_ORDER, QUOTE, WARRANTY_CLAIM, SERVICE_CONTRACT, TYRE_ORDER, VEHICLE_HISTORY_SUMMARY. OPEN_ITEM belongs only in open_items.csv. |
| origin | R enum | SOURCE or PRIOR_SYSTEM; latter means the source had itself imported older history. |
| doc_no | R text | Original number, including leading zeroes; no ACP sequence. A condensed summary without a source number uses a stable explicit `summary:<external_id>` display reference, not a fabricated invoice number. |
| doc_date | R date | Original business date, <= cutover_date; never extraction date substituted for missing evidence. Missing date is error. |
| order_no | O text | Original order number. |
| legal_entity_code | R code | Verified historical seller. |
| site_code | O code | Explicit historical ownership, no inferred current site. |
| customer_external_id | O id | Sell-to/customer reference. |
| bill_to_customer_external_id | O id | Original payer/customer reference. |
| vehicle_external_id | O id | Vehicle reference. |
| vin_snapshot | O text | Source-present VIN text, no invention from current vehicle. |
| mileage | O integer | 0–2147483647 km at the historical event. |
| currency | R enum | EUR; unsupported currency blocks, no implicit conversion. |
| net_total | R money | Original nonnegative magnitude; see signs below. |
| vat_total | R money | Original nonnegative magnitude. |
| gross_total | R money | Exactly net_total + vat_total. |
| vat_breakdown | R json | Array described below, [] only for a nonfinancial summary with all totals zero. |
| detail_level | R enum | LINES or SUMMARY. LINES requires its child rows, SUMMARY honestly signals absent detail. |
| summary_text | O multiline | Required for SUMMARY; source-present service/work narrative, no generated financial reconstruction. |
| pdf_asset_name | O text | Exact name in manifest.assets; blank means unavailable original PDF. |
| legal_hold | R boolean | Source-known hold; true blocks deletion. false cannot release an existing ACP hold. |

VAT breakdown elements have exactly `tax_code` (nonempty plain historical label <=64), `vat_rate` (pct), `vat_note` (text or null), `net`, `vat`, `gross` (signed_money). Each `(tax_code, vat_rate, vat_note)` is unique. Each bucket gross = net + vat; sums equal header totals exactly. Do not map to today's tax/accounting profiles. Zero-rated buckets need source-present explanation in vat_note; unsupported historic wording is preserved, not rewritten as a certified tax exemption.

Header INVOICE and CREDIT_MEMO totals are positive magnitudes. CREDIT_MEMO polarity is applied **once** when presenting signed balance/revenue comparisons; manifest document_totals keeps invoices and credits in separate positive-magnitude buckets. Negative source credit header totals are converted upstream into this representation. Lines and VAT buckets may be signed (e.g. a return within a positive invoice); their algebraic sum must equal the positive header magnitude in the document's own polarity. An overall negative invoice must be classified correctly upstream, not passed by absolute-value conversion of every line. Other financial document types use positive documentary amounts without creating postings. A VEHICLE_HISTORY_SUMMARY has all totals zero and no VAT buckets; do not invent amounts when detail is missing.

## `legacy_document_lines.csv`

| Column | Value | Rule |
|---|---|---|
| external_id | R id | Stable child identity. |
| document_external_id | R id | Exact parent legacy_documents.external_id in bundle or existing immutable mapped document. |
| line_no | R integer | 1–2147483647, unique per document; presentation order. |
| line_type | R enum | LABOR, PART, EXTERNAL_SERVICE, FEE, TEXT. |
| job_no | O text | Original job grouping label. |
| job_text | O multiline | Complaint/work instruction, retained verbatim canonical text. |
| code | O text | Plain historical operation/part label; no required link to today's catalog. |
| description | R multiline | Original description. |
| quantity | R signed_qty | LABOR in decimal hours, PART in unit; TEXT 0.000. |
| unit | R text | `h` for LABOR, actual part unit, `text` for TEXT; fee/external service source-present unit. |
| unit_price | R signed_money | Net historical unit price; TEXT 0.00. |
| discount_pct | R pct | Original percentage; 0.00 if no discount. |
| net | R signed_money | Exact original net after discount; authoritative. |
| vat_rate | R pct | Original rate, not today's lookup. |
| vat | R signed_money | Exact original VAT. |
| gross | R signed_money | Exactly net + vat. |
| tax_code | O text | Required for financial lines, joins exact breakdown key. |
| vat_note | O text | Original explanation; null joins null vat_note bucket. |
| cost_bearer_label | O text | Plain historical label; canonical known labels CUSTOMER/WARRANTY/GOODWILL/INTERNAL accepted without requiring the split-invoice enum/schema. No payer resolution or billing side effects. |

TEXT has all money zero, quantity zero, discount/rate zero and blank tax fields. Non-TEXT lines have nonzero signed quantity; reject inconsistent signs between quantity/unit-price/net instead of multiplying away a reversal. Original net need not equal naive quantity×unit_price after legacy discounts/rounding; preserve declared amounts and report diagnostic differences, not rewrite. Every financial line gross equality and bucket/header reconciliation is exact. Residual cents must have an explicit source rounding FEE line/bucket; importer never invents one. With detail_level LINES, sum of non-TEXT lines per bucket equals VAT breakdown; SUMMARY has no children and relies on original header/bucket evidence.

## `open_items.csv`

| Column | Value | Rule |
|---|---|---|
| external_id | R id | Accounting item identity, stable across snapshot runs. |
| document_external_id | O id | Optional legacy document reference; a missing legacy header warns, original number/date remain authoritative. |
| customer_external_id | R id | Resolved CUSTOMER in same namespace; unknown/skipped customer blocks this snapshot. |
| legal_entity_code | R code | Bundle legal entity. |
| site_code | O code | Authorized historic site or explicit unassigned access gate above. |
| doc_type | R enum | INVOICE, CREDIT_MEMO, PAYMENT, REFUND, REMINDER_FEE. |
| doc_no | R text | Original accounting document number. |
| doc_date | R date | Original date <= balance_as_of. |
| due_date | O date | May precede balance_as_of; absent is unknown, not immediately overdue. |
| currency | R enum | EUR. |
| original_amount | R signed_money | Signed accounting opening amount for this item. |
| remaining_amount | R signed_money | Same sign as original, magnitude <= abs(original); zero rows allowed but not considered outstanding. |
| balance_as_of | R date | Exactly control_totals.open_items_as_of, the actual extraction snapshot business date; <= both extraction business date and cutover_date. Never label prospective rehearsal balances as future facts. |
| instalments | R json | [] means no supplied schedule. A nonempty array has entries exactly {due_date: date, remaining_amount: signed_money}; those entries sum exactly remaining_amount, each same sign, no duplicates by due date. |
| legal_hold | R boolean | Hold cannot be lifted by replay. |

Receivables INVOICE/REMINDER_FEE and customer REFUND obligations use positive values; CREDIT_MEMO and unapplied PAYMENT credits use negative values. REFUND here means a debit item clearing a customer credit, not a second cash payment booking. Settlement events are already reflected upstream: fully applied payments are not additional outstanding negative rows. The extractor computes remaining amounts at the declared snapshot date including partial payments. Rehearsal snapshots use their actual extraction date. Final cutover evidence must certify that the selected snapshot is the frozen closing/opening balance: either taken on cutover date or at the prior closing date with a documented write freeze/no-unaccounted-movement bridge through cutover. Otherwise reconcile a new final snapshot; do not rewrite its date. If history is supplied, optional doc reference must agree on original number/date/type/currency/customer when linked; a PAYMENT/REFUND does not pretend to be a legacy invoice. No amount is recomputed from invoice gross minus guessed receipts in ACP.

Each run supplies a **complete open-items snapshot for that company**, not a delta, even in a staged bundle. New run writes a new immutable snapshot and marks the older current snapshot superseded only after all rows, totals, authorization and retention succeed atomically. A missing file leaves current snapshot unchanged; an explicit header-only file plus total 0.00 is an empty snapshot. Same manifest/run replay is no-op. Changed payload under an already applied run is conflict; use a new explicitly reconciled run. Never create `Invoice`, `Payment`, dunning or export rows, update paid state or merge snapshots by summing current and superseded runs.

## Manifest asset inventory and retention

CSV 1.1 adds required manifest `assets` (array, [] when none). Each entry has exactly `name`, `sha256`, `size_bytes`, `media_type`, `created_via`. Name matches `asset_[A-Za-z0-9_-]{1,128}.pdf`, at bundle root; MIME is `application/pdf`; size is integer 1–52428800 (50 MiB); hash is lowercase SHA-256 over original bytes. created_via is ORIGINAL_EXPORT or SOURCE_MASS_PRINT. Mass print is source-rendered output obtained before licence end, never an ACP reconstruction. The selected cap is transport validation, not permission to discard larger source evidence: oversized assets block and require a reviewed transport revision.

Asset names and CSV names occupy disjoint unique spaces. Every listed asset must be received exactly once, match size/hash and be referenced by exactly one legacy header. Every nonblank pdf_asset_name resolves to an entry. Version 1.1 requires one source document per PDF and does not accept a shared multi-document/batch PDF: that could reveal another site's/customer's evidence through one authorized download. Never assign PDFs by an ambiguous number alone. External extraction resolves collisions using company/type/date/ID before building the canonical association. Reject unlisted attachments, paths, links, archives disguised as PDFs, and failed PDF structure validation; do not execute embedded content. Original bytes are retained, not sanitized/re-rendered into replacement evidence.

For each header and child, preserve the exact UTF-8 record byte slice as received, including its record terminator when present, before CSV parsing, normalization or formula escaping. Keep the header bytes, format_version and file hash alongside those record bytes so interpretation is reproducible. Compute per-record payload_sha256 from that slice; do not hash reserialized JSON as a substitute. CSV quoting/multiline boundaries must be byte-accurate. The payload_json draft in AUT-628 needs an exact-byte/base64-backed evidence field or equivalent object storage; normalized fields are a separate projection.

Write-once rows/PDF object generations have `retain_until = 31 December of (doc_date.year + 7)` and legal_hold. A source-known longer hold/retention can extend, never shorten. Open-item evidence uses original doc_date; outstanding business/hold rules can require longer retention. Each asset inherits its sole document's retention/hold; legal_hold changes are audited privileged commands, not import fields overwriting existing holds. Keep evidence outside the 180-day staging purge; DB/object guards must survive application rollback. For an already expired minimum date, storage still remains write-once and ordinary import cannot delete it; legal basis/minimization and later deletion need explicit review.

Immutable identity is `(tenant, source_system, doc_type, external_id)` for historical headers. First publication atomically freezes the header, exact complete child-ID/hash membership (including an empty set for SUMMARY) and PDF association/bytes. Store that aggregate manifest/hash with evidence. Existing-parent submissions may only replay the exact frozen child set; no new TEXT row, zero-sum pair, omitted child or late asset attachment is accepted, even under a new run. Same bytes and membership replay no-op; any change conflicts without overwrite. Open-item identity additionally includes the snapshot/run, as described above. Original dates/numbers are never rewritten. Show **Altbeleg aus Vorsystem (incadea), nicht in ACP erstellt** and origin PRIOR_SYSTEM badge when applicable. Corrections are new ACP documents referencing the old number; no fabricated ACP predecessor, no legacy cancel/credit/re-render action.

## Manifest controls

The main schema's `counts_by_type` counts physical logical rows per CSV. Additionally `control_totals.domain_counts.legacy_documents` is null when absent or a full zero-inclusive map of the eight doc_type values above; `open_items` analogously maps its five types. Both sums equal respective file row_count, including zero balances and unlinked history. Required control_totals.open_items_as_of is null iff the file is absent, otherwise one actual snapshot date shared by all rows, including an explicit empty snapshot. Domain-count key `open_items` is distinct from the existing signed money `control_totals.open_items`.

`document_totals` keeps exactly one positive-magnitude INVOICE/CREDIT_MEMO bucket per original year_month/doc_type, with row_count/net/vat/gross matching all supplied headers before linking/skips. No financial header can be skipped while presenting totals as complete. `control_totals.open_items` is the signed sum of all supplied remaining_amount, including payments/credits; per-customer subtotals in the report sum to it. No tolerance or double negation. Legacy detail lines are not added again to header totals. Missing/duplicate/extra buckets, currency or totals mismatch blocks the stage before publication.

## Synthetic examples

These short examples have every header. Codes SELLER_A, S1, C001 and V001 are synthetic preconfigured references; `asset_example.pdf` must have a real manifest entry/hash if used in a complete fixture. Here pdf_asset_name is blank, honestly recording a missing PDF.

```csv
external_id,doc_type,origin,doc_no,doc_date,order_no,legal_entity_code,site_code,customer_external_id,bill_to_customer_external_id,vehicle_external_id,vin_snapshot,mileage,currency,net_total,vat_total,gross_total,vat_breakdown,detail_level,summary_text,pdf_asset_name,legal_hold
H001,INVOICE,SOURCE,OLD-001,2026-09-30,,SELLER_A,S1,C001,,V001,,10000,EUR,100.00,20.00,120.00,"[{""tax_code"":""VAT20"",""vat_rate"":""20.00"",""vat_note"":null,""net"":""100.00"",""vat"":""20.00"",""gross"":""120.00""}]",LINES,,,false
H002,CREDIT_MEMO,PRIOR_SYSTEM,OLD-C01,2026-09-30,,SELLER_A,S1,C001,,,,,EUR,10.00,2.00,12.00,"[{""tax_code"":""VAT20"",""vat_rate"":""20.00"",""vat_note"":null,""net"":""10.00"",""vat"":""2.00"",""gross"":""12.00""}]",SUMMARY,Original credit summary,,false
```

```csv
external_id,document_external_id,line_no,line_type,job_no,job_text,code,description,quantity,unit,unit_price,discount_pct,net,vat_rate,vat,gross,tax_code,vat_note,cost_bearer_label
HL001,H001,1,LABOR,J1,Service,OP1,Service labor,1.000,h,100.00,0.00,100.00,20.00,20.00,120.00,VAT20,,CUSTOMER
```

```csv
external_id,document_external_id,customer_external_id,legal_entity_code,site_code,doc_type,doc_no,doc_date,due_date,currency,original_amount,remaining_amount,balance_as_of,instalments,legal_hold
OI001,H001,C001,SELLER_A,S1,INVOICE,OLD-001,2026-09-30,2026-10-14,EUR,120.00,70.00,2026-11-01,[],false
OI002,H002,C001,SELLER_A,S1,CREDIT_MEMO,OLD-C01,2026-09-30,,EUR,-12.00,-12.00,2026-11-01,[],false
```

Expected supplied counts: 2 headers, 1 line, 2 open items; document buckets INVOICE 100/20/120 and CREDIT_MEMO 10/2/12 for 2026-09; open-item total 58.00 and open_items_as_of=2026-11-01, assuming extraction on that business date. The invoice's 50.00 settlement is already included in its remaining 70.00, not imported again as a negative payment.

## Database, API, UX and state impact

No runtime/schema/API changes in this documentation PR. AUT-628/629 must reconcile storage for raw record bytes, asset provenance/size/generations, VAT buckets, unassigned access and composite child/run identity; these are release prerequisites, not dropped columns. Plain historical cost_bearer_label does not depend on AUT-640's enum; the current schema-slot order is AUT-624 → AUT-628 → AUT-641 → AUT-643 → AUT-640 → AUT-644 (AUT-646 supersedes stale dependency text). Future entities must update deletion/tenant-restore policies. No present-day invoice numbering/export/KPI revenue paths may depend on these tables.

AUT-629/630 provide scoped read-only lists/details/downloads and CSV export through existing layout conventions. No native invoice edit/payment/dunning button or customer reminder is added by import. Unknown due date is visibly unknown. State publication is staged → validated → atomically applied/current (or failed); prior current open-items snapshot remains readable until replacement succeeds. OpenAPI/type regeneration and realtime opt-in are handled only when API code changes, not by this spec.

## Testing and completion gates

- Exact headers/JSON/CSV quotes, multiline byte-slice hashes and original PDF size/hash/provenance; ambiguity and missing assets block, missing optional PDF warns.
- Positive credit magnitudes, signed mixed lines and VAT buckets, partial settlements, zero and negative open balances, per-customer/overall sums; no guessed cents/VAT.
- Unknown history links warn without recreating anonymized customers; foreign tenant/entity/site references never link. Unassigned history stays inaccessible to ordinary site routes.
- Replay/changed evidence conflict (including appended/omitted zero-value children), atomic new snapshot supersession, failed/empty/missing snapshot cases, holds/retention extensions and forbidden shared PDFs.
- Assert no Invoice/Payment/sequence/accounting-export/readiness/KPI-revenue effects; verify immutable records and new corrective-doc references.

AUT-650 is complete as a spec when these dictionaries, assets and controls are merged with CSV 1.1. Import code stays in [AUT-629](https://linear.app/auto-core-platform/issue/AUT-629) and [AUT-630](https://linear.app/auto-core-platform/issue/AUT-630), schema reconciliation in [AUT-628](https://linear.app/auto-core-platform/issue/AUT-628), archive/DPA/RKSV/sign-off in AUT-634. No open wire-format decisions remain.
