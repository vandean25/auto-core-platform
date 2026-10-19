---
title: "Canonical Migration CSV 1.1 and Manifest"
date: "2026-10-19"
module: Platform
status: accepted
linear-project: "incadea Migration"
tags: [feature-spec, platform, migration]
---

# Canonical Migration CSV 1.1 and Manifest

## Status

**Accepted — 2026-10-19, Dejan Dosenovic (Product Owner).** Version 1.0 was accepted for AUT-645 after independent review. Revision 1.1 completes AUT-647/648/649/650 as requested for main; the prerequisite payer model is AUT-646. Production import/cutover remains subject to the implementation and evidence gates below.

## Summary

Define the source-agnostic file boundary between an external read-only extractor and ACP. [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md) is the accepted strategy. This specification fixes the wire contract for the validator, synthetic fixtures and mapping preset in [AUT-645](https://linear.app/auto-core-platform/issue/AUT-645). It does not implement an extractor, importer or production cutover.

The extractor stays in a separate private repository. ACP code, fixtures, documents and PRs contain no source-system table IDs, proprietary field/table names or source excerpts. Examples are synthetic; use only “pilot customer”. Real data requires the DPA gate in AUT-634, including rehearsals.

## User Stories

- As migration operations, I want one deterministic file contract so exports can be checked before dry-run or apply.
- As an implementer, I want explicit types, reference rules and control totals so different source systems produce the same ACP input.
- As the business owner, I want company-separated, repeatable imports that preserve fiscal history and customer restrictions.

## Contract scope and file registry

**Version `1.1`.** [Version 1.0](migration-csv-format-v1.0.md) is preserved byte-for-byte as accepted in PR #900; validators select the exact version and never reinterpret a 1.0 bundle with these new dictionaries. Existing 1.0 core column meanings are unchanged. The four normative domain specifications below are part of this revision, not unimplemented outlines.

 One bundle represents one source company, one extraction snapshot and one cutover date. Multiple companies require separate bundles and namespaces, mapped to separate legal entities in the same tenant. The bundle may contain a subset of files for rehearsal or staged migration. Missing files mean **not supplied**, not empty or deleted; every supplied file must be listed exactly once in the manifest, including header-only files.

“Defined” means that all columns and validation rules are fixed here or in the normative linked domain dictionaries. Definition is not evidence of an installed handler. A validator must reject an unimplemented capability explicitly, never silently skip it or pretend the migration is complete.

| File | Contract | Handler/domain owner |
|---|---|---|
| `customers.csv` | Defined | CUSTOMER; AUT-632/638/639 |
| `vehicles.csv` | Defined | VEHICLE; dealer-stock activation remains separately gated |
| `vendors.csv` | Defined | VENDOR; AUT-625 |
| `parts.csv` | Defined | PART; AUT-625 |
| `stock_opening.csv` | Defined | STOCK_OPENING_BALANCE; AUT-626 |
| `labor_operations.csv` | Defined | LABOR_OPERATION; AUT-637 |
| `labor_standard_times.csv` | Defined | LABOR_STANDARD_TIME; AUT-637 |
| `labor_price_groups.csv` | Defined | LABOR_PRICE_GROUP; AUT-637 |
| `labor_packages.csv` | Defined | LABOR_PACKAGE headers/versions; AUT-643 |
| `labor_package_items.csv` | Defined | LABOR_PACKAGE child rows; AUT-643 |
| `vehicle_parties.csv` | [Defined in 1.1 — AUT-647](migration-csv-vehicles.md) | VEHICLE_PARTY; AUT-641 |
| `vehicle_due_dates.csv` | [Defined in 1.1 — AUT-647](migration-csv-vehicles.md) | VEHICLE_DUE_DATE; AUT-641 |
| `vehicle_notices.csv` | [Defined in 1.1 — AUT-647](migration-csv-vehicles.md) | VEHICLE_NOTICE; AUT-642 |
| `tyre_sets.csv` | [Defined in 1.1 — AUT-648](migration-csv-tyres.md) | TYRE_SET; AUT-636 |
| `open_orders.csv`, `open_order_tasks.csv`, `open_order_lines.csv` | [Defined in 1.1 — AUT-649](migration-csv-open-orders.md) | OPEN_WORKSHOP_ORDER aggregate; AUT-631 |
| `legacy_documents.csv`, `legacy_document_lines.csv` | [Defined in 1.1 — AUT-650](migration-csv-history.md) | Legacy history; AUT-628/629 |
| `open_items.csv` | [Defined in 1.1 — AUT-650](migration-csv-history.md) | LEGACY_OPEN_ITEM; AUT-630 |

`manifest.json` is mandatory. No arbitrary extra files, absolute paths, nested paths, archive path traversal or duplicate filenames are allowed. Version 1.1 additionally accepts only original PDF assets explicitly inventoried under manifest.assets, as defined in AUT-650; assets are not CSV records and are never counted as rows. Archive packaging/transport does not change these logical filenames.

## CSV and scalar rules (normative)

1. UTF-8, strictly decoded; writers emit no BOM, readers may accept one leading UTF-8 BOM. Comma delimiter, RFC 4180 quoting, exactly one header record, CRLF record separators; readers also accept LF. A final record separator is optional. Quote comma, quote and embedded newline cells; escape a quote as `""`. Record count is logical data records, excluding the header, not physical lines. Blank records and mismatched cell counts are errors.
2. Header names are the English `snake_case` names below, in table order. **All listed headers are required**, including optional-value columns. Unknown, duplicate, missing or reordered headers are blocking errors. No localized aliases or delimiter/encoding guessing in the canonical validator.
3. R = required nonempty value; O = optional value. Empty unquoted and quoted-empty cells both mean absent/null. Literal `null`, `NULL` and `\\N` are text, not null markers. Blank defaulted values use the stated default on creation only. On update, blank optional cells mean **leave unchanged**, not erase; canonical v1 has no field-clear operation. Replacing relationship/child collections is never inferred from omission.
4. Text is Unicode; reject NUL and other C0 controls except embedded CR/LF in explicitly multiline fields. No leading/trailing whitespace in IDs, codes, enums, dates or numbers. Preserve description/name text and raw CSV bytes. Do not apply spreadsheet-formula escaping to canonical evidence; treat uploads as data, never evaluate cells, and neutralize formulas only in separate human-facing spreadsheet exports.
5. `id` = case-sensitive opaque text, 1–128 characters, including leading zeroes; no trimming, numeric conversion or case folding. Each data row has a stable `external_id`, unique within its logical file/entity and company namespace. Child rows have their own IDs. `code` = 1–128 characters; `text` = up to 255 unless a row states otherwise; `multiline` = up to 4,000. Empty optional IDs mean no reference.
6. `date` = a real Gregorian `YYYY-MM-DD`; timestamp = a real UTC `YYYY-MM-DDTHH:mm:ssZ`. `year` = integer 1900–2100. Booleans are exactly `true` or `false`. Enum tokens are case-sensitive uppercase ACP values. Countries use ISO 3166-1 alpha-2; currency v1 is `EUR`. No locale-formatted numbers, grouping, exponent, NaN, infinity or leading `+`.
7. `money` = nonnegative decimal with exactly two fraction digits and at most eight integer digits; `qty` = nonnegative decimal with exactly three fraction digits and at most seven integer digits. No negative zero. Quantities/prices/totals use decimal arithmetic, never binary floating point. Rates and unit prices are **net**. Source gross prices and source labor units are converted upstream; never infer VAT or time conversion from a label.
8. `hours` uses the money lexical shape (two decimal places, nonnegative) but denotes **decimal hours**, not currency. ACP's `standard_aw` currently represents allocated hours. For example, 12 source units at 12 units/hour become `1.00`. The extractor uses the verified source unit basis and rounds half-up to 0.01 hour; record conversion evidence in rehearsal documentation outside the canonical rows. A missing source basis blocks extraction of those times.
9. Defaults and lengths here are the canonical validator's bounds; target-domain validation can additionally block an apply. There is no truncation, guessed enum fallback or fabricated required business value. Validation reports filename, logical row number (first data row = 1), external ID, field and stable error code; raw personal data is not copied into general logs.

## Ownership, references and apply rules

The authenticated import context supplies the tenant. An OWNER/ADMIN-approved configuration maps `(source_system, source_company_code)` to exactly one legal entity and maps `site_code`, `bin_code`, revenue-group codes and labor make prefixes to authorized ACP records. Bundle data never authorizes tenant/site access and contains no trusted ACP IDs. Missing/ambiguous/foreign-entity site mappings block the affected stage. The site/legal entity must be active when applying operational data.

For incadea, `source_name = "incadea"` and `source_system` is exactly `"incadea:" + source_company_code`. Other extractors use the same `source_name:source_company_code` construction. Both components match `[a-z0-9][a-z0-9_-]{0,63}`; assign a stable opaque lowercase company code once, rather than using or repeatedly normalizing a display name. Namespace codes must not contain the pilot customer's real name in fixtures/docs. The namespace is unchanged between rehearsals and final extraction.

References ending in `_external_id` resolve through the same tenant/company namespace, either to an included row or an existing external mapping of the stated target type. No global-ID, name, email, plate or VIN lookup across tenants. Unresolved required references are errors; only the optional vendor edge on parts has the explicit warning policy below. Bill-to and supersession references resolve in a second pass after parent imports; cycles are errors.

`ExternalIdMapping` uses `(tenant_id, entity_type, source_system, external_id)`. Same accepted input is a no-op on replay. A changed master row follows `update_existing`/`fill_empty_only` after dry-run; neither option overrides blocked customers, restrictions, ownership or fiscal guards. Contradictory external mapping and natural-key matches block apply rather than relinking silently. A missing row never deletes a record.

Apply stages follow ADR-0031: master data → parties/notices → labor/parts → opening stock → tyres → open orders → history → open items. Within master data, import customer identities and vendors first; resolve customer price-group/bill-to edges after price groups/customer identities exist. Within labor, price groups and operation identities precede standard times and packages; package items follow package versions and referenced parts/labor. Dry-run checks the full dependency graph first.

For 1.1 actual source-evidence business dates use the approved source legal entity timezone (AT Europe/Vienna; DE Europe/Berlin), never the host clock. Actual performed/document/storage/activity dates cannot postdate that calendar date of extracted_at or cutover_date, whichever is earlier. Future due/planned dates are expressly exempt. The mapping is approved configuration, not user-supplied authorization. Open-item snapshots additionally declare their actual as-of date as specified by AUT-650; a future rehearsal cutover is not evidence of future accounting balances.

## Defined file dictionaries

Table order is the exact header order. Optional text/date/reference values default to null unless otherwise stated. Defaults for updates follow scalar rule 3.

### `customers.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | CUSTOMER identity. |
| type | R enum | PRIVATE or COMPANY; no heuristic fallback. |
| company_name | O text | Required for COMPANY. |
| first_name | O text | Required for PRIVATE; blank COMPANY name components stored as empty strings where today's model requires them. |
| last_name | O text | Required for PRIVATE. |
| email | O text | Valid email; compare using existing customer-email normalization; duplicate normalized email in file/tenant is a blocking conflict, not a merge instruction. |
| phone | O text | Preserve supplied phone formatting. |
| vat_id | O text | Validate with ACP country-specific VAT validation; invalid supplied ID is an error. |
| address_street | O text | Address. |
| address_zip | O text | Preserve leading zeroes. |
| address_city | O text | Address. |
| address_country | O country | No guessed default in the wire format; target creation may use its documented AT default when blank. |
| salutation | O enum | MR, MS, NEUTRAL, COMPANY; AUT-624/639. |
| title | O text | Academic/personal title. |
| title_suffix | O text | Post-name title. |
| letter_salutation | O text | Explicit greeting override; no embedded newline. |
| block_level | O enum | NONE, INVOICING, ALL; creation default NONE. |
| block_reason | O text | Required when supplied block_level is INVOICING or ALL. |
| payment_terms_days | O integer | 0–3650; no guessed payment term when blank. |
| payment_terms_text | O text | Agreed payment wording. |
| bill_to_external_id | O id | CUSTOMER reference; no self, cycles or chains longer than one edge (AUT-638). |
| labor_price_group_code | O code | Resolve unique labor_price_groups.code within the same namespace. |
| last_activity_date | O date | Latest qualifying business activity, not extraction timestamp; must not be after cutover_date. |
| has_open_matters | R boolean | Upstream aggregation of open orders/receivables, warranty/goodwill, stored tyres or legal hold. |
| privacy_objection | R boolean | No inferred consent; preserve restrictive meaning. |
| mail_stop | R boolean | No marketing authorization. |
| anonymized | R boolean | true always SKIP, before identity/name validation; never recreate a person from anonymized data. |

AUT-632 evaluates at manifest cutover_date (not the machine clock). Import if last_activity_date is on/after 1 January of cutover year minus 7, or has_open_matters is true. Otherwise SKIP with reason; no date plus no open matters is SKIP. An included customer is restricted when `last_activity_date <= cutover_date minus three calendar years`; no date plus open matters is also restricted. Clamp 29 February to 28 February when subtracting years. Thus at 2026-11-01 the inclusion floor is 2019-01-01 and restriction threshold is 2023-11-01: activity on that exact anniversary is restricted, activity on 2023-11-02 is not age-restricted. Open matters preserve inclusion, not contact permission. Anonymized always wins. Extraction must include retention-required bill-to parties as open matters when needed by an open order; a reference to a skipped customer otherwise blocks its dependent row.

Restricted/objection/mail-stop records never gain marketing consent. There are no consent-grant columns. Date of birth, social security number, bank accounts/IBAN, marital status, children, hobbies and profession are **excluded**, including aliases and catch-all payload columns. Unknown headers fail rather than silently retaining excluded data.

### `vehicles.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | VEHICLE identity. |
| vin | O text | Uppercase 17-character ISO VIN charset (no I/O/Q); invalid format blocks, check-digit mismatch warns. Missing VIN requires explicit allow_missing_vin approval. |
| plate | O text | Existing plate normalization; same plate on several rows warns but never merges vehicles. |
| make | R text | Plain make name; resolve via existing VehicleMakeAlias/Brand policy, not a source code. |
| model | R text | Plain model name. |
| year | R year | Vehicle year. |
| engine_code | O text | Exact Vehicle.engine_code; required to select an engine-qualified labor standard time. No inferred value from VIN/model. A nonempty value requires vehicle-handler support; otherwise block with unsupported capability, never discard it. |
| first_registration_date | O date | Actual date; no day/month inference. |
| mileage | O integer | 0–2147483647 km. |
| color | O text | Plain description. |
| owner_customer_external_id | O id | CUSTOMER main-contact/owner edge; unknown or skipped customer is an error. Additional roles use vehicle_parties. |
| key_number | O text | Existing ACP import field. |
| inventory_role | O enum | CUSTOMER, USED, NEW, DEMO; creation default CUSTOMER. |

Duplicate nonempty VIN within file or a conflicting existing identity is an error for the canonical preset; do not conflate distinct external IDs automatically. A non-CUSTOMER role is validated but cannot activate dealer stock without the separately implemented, authorized lot/site/vehicle-ledger workflow. Unsupported role handling is a blocking capability error, never downgrade to CUSTOMER or infer a lot.

### `vendors.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | VENDOR identity. |
| name | R text | Vendor display name. |
| account_number | R code | Supplier accounting/customer-account reference, **not a bank account**. |
| email | O text | Valid email if present. Missing: handler generates `migration-<sha256(source_system + LF + external_id)>@example.invalid`, using the full lowercase hex digest, and warns. Never send to placeholder addresses. |
| address_street | O text | Canonical vendor address; future storage support required (see Database Impact). |
| address_zip | O text | Preserve leading zeroes. |
| address_city | O text | Address. |
| address_country | O country | No guessed country. |
| supported_brands | O text | JSON array of distinct plain brand names inside one quoted CSV cell; `[]`/blank = no supplied brands. No source brand IDs. |

Unknown brands block address/brand apply until explicitly mapped; do not create arbitrary brands by fuzzy name. A changed placeholder is not an email-based vendor merge. Vendor address support must preserve these fields or reject the affected row explicitly; silently dropping them is forbidden.

### `parts.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | PART identity, separate from SKU. |
| sku | R code | CatalogItem.sku; duplicates in file error. |
| name | R text | Part description. |
| unit | R text | ACP unit string, e.g. pcs, l, kg; case-sensitive approved unit mapping. |
| cost_price | O money | Net acquisition cost; blank unknown, not zero. |
| retail_price | R money | Net selling price. |
| ean | O text | 8/12/13/14 digits, preserve zeroes; validate GS1 check digit. |
| make | O text | Plain part manufacturer name resolved to Brand. |
| revenue_group_code | O code | Authorized, tenant-scoped configured RevenueGroup mapping; unknown code error. |
| vendor_external_id | O id | VENDOR reference; unknown vendor warns and leaves only this link unbound. |
| vendor_part_no | O code | VendorArticle supplier_article_no; supplied only together with vendor_external_id. Unknown vendor skips VendorArticle with warning, not the part. |
| superseded_by_external_id | O id | PART reference; second pass; no self/cycle. |
| core_charge_net | O money | Creation default 0.00; retained as an attribute, not an invoice/tax calculation. |
| is_core_part | O boolean | Creation default false; true or positive core_charge_net produces warning pending AUT-644. |

Only actual parts belong here; vehicles/equipment are excluded upstream. External mapping wins, then an unambiguous tenant SKU match, then an unambiguous EAN match; disagreement between keys is a blocking conflict. Preserve source_system from the manifest and external_article_id from external_id. No matching by description. Gross-to-net conversion and core-charge tax eligibility must be verified upstream/at cutover; no fabricated tax rates.

### `stock_opening.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | Stable opening-row identity across rehearsals. |
| part_external_id | R id | PART reference. |
| site_code | R code | Explicit configured site owned by the bundle's legal entity. |
| bin_code | R code | Unique configured bin path/code within that site. |
| quantity | R qty | Absolute physical on-hand snapshot, zero allowed; negative is error. |
| unit_cost | R money | Net cost per part unit; quantity unit is the referenced part.unit. |

One row per resolved `(part, site, location, cutover_date)`; two external IDs resolving to the same tuple error. Effective date is manifest cutover_date; reference_id is `migration-opening:<cutover_date>`. AUT-626 posts INITIAL_BALANCE through inventory services, never direct stock-cache writes. Replay unchanged is no-op; changed rehearsal quantity posts only the authorized delta and is refused after any subsequent non-opening movement. Cost-only differences also block automatic apply pending explicit reconciliation; do not disguise them as quantity deltas. Missing bins follow a reviewed AUT-626 site-local creation/default mapping with warning, not creation of a site or legal entity.

Control stock value = sum of each row's `quantity * unit_cost`, rounded half-up to two decimals **per row**, then summed, in EUR; include zero rows. Target quantity bounds and total stock capacity must be checked, not only each row. Manifest totals describe this canonical valuation, not an unconverted source gross valuation.

### `labor_price_groups.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | LABOR_PRICE_GROUP identity. |
| code | R code | Unique within company file; existing tenant code conflict requires explicit identity mapping. |
| name | R text | Display name. |
| hourly_rate | R money | Strictly positive net EUR per hour. |
| is_active | O boolean | Creation default true. |

### `labor_operations.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | LABOR_OPERATION identity. |
| make | R text | Plain make name, alias-resolved. |
| code | R code | Original operation code within that make. |
| description | R text | Display text. |
| standard_aw | R hours | Allocated time in decimal hours. |
| hourly_rate | R money | Strictly positive net EUR per hour. |
| internal_cost | O money | Existing operation internal-cost meaning; no automatic rate conversion. |
| category_name | O text | Exact tenant LaborCategory name; unknown warns and leaves category unset on creation. |
| is_active | O boolean | Creation default true. |

The configured, immutable make prefix plus original code produces tenant-unique ACP LaborOperation.code (AUT-637). E.g. synthetic make “Example Make” with prefix EX- and code 001 produces EX-001. Two alias names resolving to the same make/code conflict, not two operations. Preserve original code as external_operation_code; existing mapping identity remains external_id. Prefix configuration is persisted outside the file and cannot change on retry. Reject resulting tenant-code collisions and field-length overflow. No make guessing from operation text.

### `labor_standard_times.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | LABOR_STANDARD_TIME identity. |
| make | R text | Same make resolution as operations. |
| code | R code | Existing original operation code for this make. |
| model | R text | Exact ACP vehicle model match; canonical v1 has no proprietary model-key field. |
| year_from | O year | Inclusive lower bound; blank unbounded. |
| year_to | O year | Inclusive upper bound; blank unbounded; if both supplied, from <= to. |
| engine_code | O text | Optional exact vehicle engine-code qualifier. |
| standard_aw | R hours | Fitment-specific allocated hours, overrides operation default. |

Resolve operation by `(resolved make, original code)` from this bundle or mapped operations. Reject overlapping year intervals for the same operation/model/engine qualifier; reject overlaps between an unqualified engine row and a specific-engine row for the same model, so matching a vehicle is never ambiguous. No match uses operation.standard_aw. Customer labor-price-group rate overrides operation.hourly_rate (AUT-637); imported money/time never silently rewrites a committed invoice.

### `labor_packages.csv`

Each row describes one package version; logical package identity is `code`, row external identity is the version. Include `labor_package_items.csv` whenever nonempty package versions are supplied.

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | Stable package-version import identity. |
| code | R code | Tenant-unique logical package code; multiple rows only for distinct versions. |
| name | R text | Same across versions of the same package. |
| make | O text | Plain make name, blank generic. Same across versions of a package. |
| description | O multiline | Package description, same across versions. |
| is_active | O boolean | Logical package activity; creation default true, consistent across versions. |
| version | R integer | 1–2147483647; unique `(code, version)`. |
| valid_from | R date | Inclusive start. |
| valid_to | O date | Inclusive end; >= valid_from. |
| fixed_price_net | O money | Null = price from lines; 0.00 = intentional free fixed-price package. |
| fitment_model | O text | Blank all models; model requires make. |
| fitment_year_from | O year | Inclusive bound. |
| fitment_year_to | O year | Inclusive bound; ordered if both supplied. |

Reject overlapping validity intervals for versions of one package, regardless of fitment. Selection is one version valid on the order's business date whose make/model/year matches; do not pick an arbitrary version on ties. Existing package identity may be matched by unique tenant code only after conflict checks. Version/item storage and LABOR_PACKAGE mapping semantics are delivered in AUT-643, not present today.

### `labor_package_items.csv`

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | Stable child-row identity; retained under its parent version, not as a made-up ImportEntityType. |
| package_version_external_id | R id | Exact parent labor_packages.external_id. |
| line_no | R integer | 1–2147483647, unique per version, ascending presentation order. |
| type | R enum | LABOR, PART, TEXT. |
| labor_operation_external_id | O id | Required only for LABOR. |
| part_external_id | O id | Required only for PART. |
| description | O multiline | TEXT requires nonempty value; LABOR/PART may override display description. |
| quantity | R qty | LABOR/PART > 0; LABOR quantity is hours. TEXT exactly 0.000. |
| unit_price | O money | Optional net EUR per item unit/hour; null uses referenced current rate at package expansion, not at historical invoice rendering. TEXT must be blank. |

Require exactly the reference appropriate to type; other reference columns must be blank. No nested packages. Every version has at least one LABOR/PART item. One replay must not append duplicate versions/items. Fixed-price allocation and shop-supplies behavior remain AUT-643 domain logic; the validator checks values/references without generating fiscal lines.

## Complete versioned domain dictionaries

The following files contain the **normative exact ordered column dictionaries, conditional values, references, duplicate/replay rules and synthetic examples** for 1.1. They replace all 1.0 reserved outlines. Implementers must read the linked dictionary as part of this contract; a link does not mean the data may be skipped.

| Spec | Files | Implementation owner |
|---|---|---|
| [AUT-647 — Vehicle parties, due dates and notices](migration-csv-vehicles.md) | vehicle_parties, vehicle_due_dates, vehicle_notices | AUT-641/642 |
| [AUT-648 — Tyre sets](migration-csv-tyres.md) | tyre_sets | AUT-636 |
| [AUT-649 — Open orders](migration-csv-open-orders.md) | open_orders, open_order_tasks, open_order_lines | AUT-631; [AUT-646 payer model](../Finance/split-invoicing-multi-payer.md) |
| [AUT-650 — Legacy history and open items](migration-csv-history.md) | legacy_documents, legacy_document_lines, open_items; original PDF assets | AUT-629/630 |

New-file scalar exceptions (signed historical amounts, strict JSON cells and domain-specific units) are defined locally. They do not change the earlier core files. DOMAIN COUNTS are supplied-row controls before business skips, separate from actual apply/skip/conflict counts. Their map rules below are mandatory in 1.1. No subsequent edit may silently change the meaning of version 1.1; further contract changes require another revision.

## Manifest and reconciliation

`manifest.json` is strict UTF-8 JSON with no duplicate object keys, no comments and no trailing commas. The JSON Schema below uses Draft 2020-12. Format validators for date/date-time must be enabled; cross-field rules below are equally normative because JSON Schema alone cannot express them.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ACP canonical migration manifest v1.1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "format_version",
    "source_name",
    "source_system",
    "source_company_code",
    "extracted_at",
    "cutover_date",
    "currency",
    "files",
    "control_totals",
    "assets"
  ],
  "properties": {
    "format_version": {
      "const": "1.1"
    },
    "source_name": {
      "$ref": "#/$defs/namespaceCode"
    },
    "source_system": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]{0,63}:[a-z0-9][a-z0-9_-]{0,63}$"
    },
    "source_company_code": {
      "$ref": "#/$defs/namespaceCode"
    },
    "extracted_at": {
      "type": "string",
      "format": "date-time",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
    },
    "cutover_date": {
      "type": "string",
      "format": "date"
    },
    "currency": {
      "const": "EUR"
    },
    "files": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "sha256",
          "row_count"
        ],
        "properties": {
          "name": {
            "$ref": "#/$defs/fileName"
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "row_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2147483647
          }
        }
      }
    },
    "control_totals": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "counts_by_type",
        "stock_value",
        "open_items",
        "document_totals",
        "domain_counts",
        "open_orders_net",
        "open_items_as_of"
      ],
      "properties": {
        "counts_by_type": {
          "type": "object",
          "minProperties": 1,
          "maxProperties": 20,
          "propertyNames": {
            "enum": [
              "customers",
              "vehicles",
              "vendors",
              "parts",
              "stock_opening",
              "labor_operations",
              "labor_standard_times",
              "labor_price_groups",
              "labor_packages",
              "labor_package_items",
              "vehicle_parties",
              "vehicle_due_dates",
              "vehicle_notices",
              "tyre_sets",
              "open_orders",
              "open_order_tasks",
              "open_order_lines",
              "legacy_documents",
              "legacy_document_lines",
              "open_items"
            ]
          },
          "additionalProperties": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2147483647
          }
        },
        "stock_value": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/amount"
            }
          ]
        },
        "open_items": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/signedAmount"
            }
          ]
        },
        "document_totals": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "year_month",
              "doc_type",
              "row_count",
              "net",
              "vat",
              "gross"
            ],
            "properties": {
              "year_month": {
                "type": "string",
                "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])$"
              },
              "doc_type": {
                "enum": [
                  "INVOICE",
                  "CREDIT_MEMO"
                ]
              },
              "row_count": {
                "type": "integer",
                "minimum": 1,
                "maximum": 2147483647
              },
              "net": {
                "$ref": "#/$defs/amount"
              },
              "vat": {
                "$ref": "#/$defs/amount"
              },
              "gross": {
                "$ref": "#/$defs/amount"
              }
            }
          }
        },
        "domain_counts": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "vehicle_parties",
            "vehicle_due_dates",
            "vehicle_notices",
            "tyre_sets",
            "open_orders",
            "open_order_lines",
            "legacy_documents",
            "open_items"
          ],
          "properties": {
            "vehicle_parties": {
              "$ref": "#/$defs/vehicle_partiesCounts"
            },
            "vehicle_due_dates": {
              "$ref": "#/$defs/vehicle_due_datesCounts"
            },
            "vehicle_notices": {
              "$ref": "#/$defs/vehicle_noticesCounts"
            },
            "tyre_sets": {
              "$ref": "#/$defs/tyre_setsCounts"
            },
            "open_orders": {
              "$ref": "#/$defs/open_ordersCounts"
            },
            "open_order_lines": {
              "$ref": "#/$defs/open_order_linesCounts"
            },
            "legacy_documents": {
              "$ref": "#/$defs/legacy_documentsCounts"
            },
            "open_items": {
              "$ref": "#/$defs/open_itemsCounts"
            }
          }
        },
        "open_orders_net": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/amount"
            }
          ]
        },
        "open_items_as_of": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date"
            }
          ]
        }
      }
    },
    "assets": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "sha256",
          "size_bytes",
          "media_type",
          "created_via"
        ],
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^asset_[A-Za-z0-9_-]{1,128}\\.pdf$"
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 52428800
          },
          "media_type": {
            "const": "application/pdf"
          },
          "created_via": {
            "enum": [
              "ORIGINAL_EXPORT",
              "SOURCE_MASS_PRINT"
            ]
          }
        }
      }
    }
  },
  "$defs": {
    "namespaceCode": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
    },
    "amount": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]{0,17})\\.[0-9]{2}$"
    },
    "signedAmount": {
      "type": "string",
      "pattern": "^-?(0|[1-9][0-9]{0,17})\\.[0-9]{2}$",
      "not": {
        "const": "-0.00"
      }
    },
    "fileName": {
      "enum": [
        "customers.csv",
        "vehicles.csv",
        "vendors.csv",
        "parts.csv",
        "stock_opening.csv",
        "labor_operations.csv",
        "labor_standard_times.csv",
        "labor_price_groups.csv",
        "labor_packages.csv",
        "labor_package_items.csv",
        "vehicle_parties.csv",
        "vehicle_due_dates.csv",
        "vehicle_notices.csv",
        "tyre_sets.csv",
        "open_orders.csv",
        "open_order_tasks.csv",
        "open_order_lines.csv",
        "legacy_documents.csv",
        "legacy_document_lines.csv",
        "open_items.csv"
      ]
    },
    "vehicle_partiesCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "OWNER",
            "DRIVER",
            "USER",
            "BILL_TO",
            "LEASING",
            "INSURANCE",
            "WARRANTY_PROVIDER",
            "SERVICE_CONTRACT",
            "PREVIOUS_OWNER"
          ],
          "properties": {
            "OWNER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "DRIVER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "USER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "BILL_TO": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "LEASING": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "INSURANCE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "WARRANTY_PROVIDER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "SERVICE_CONTRACT": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "PREVIOUS_OWNER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "vehicle_due_datesCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "INSPECTION_57A",
            "SERVICE"
          ],
          "properties": {
            "INSPECTION_57A": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "SERVICE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "vehicle_noticesCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "CAMPAIGN",
            "RECALL",
            "REMARK",
            "WARNING",
            "SERVICE_DUE"
          ],
          "properties": {
            "CAMPAIGN": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "RECALL": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "REMARK": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "WARNING": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "SERVICE_DUE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "tyre_setsCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "IN_STORAGE",
            "ON_VEHICLE",
            "RETURNED",
            "DISPOSED"
          ],
          "properties": {
            "IN_STORAGE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "ON_VEHICLE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "RETURNED": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "DISPOSED": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "open_ordersCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "ORDER",
            "QUOTE",
            "SCHEDULED"
          ],
          "properties": {
            "ORDER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "QUOTE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "SCHEDULED": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "open_order_linesCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "LABOR",
            "PART",
            "FEE",
            "TEXT"
          ],
          "properties": {
            "LABOR": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "PART": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "FEE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "TEXT": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "legacy_documentsCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "INVOICE",
            "CREDIT_MEMO",
            "SERVICE_ORDER",
            "QUOTE",
            "WARRANTY_CLAIM",
            "SERVICE_CONTRACT",
            "TYRE_ORDER",
            "VEHICLE_HISTORY_SUMMARY"
          ],
          "properties": {
            "INVOICE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "CREDIT_MEMO": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "SERVICE_ORDER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "QUOTE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "WARRANTY_CLAIM": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "SERVICE_CONTRACT": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "TYRE_ORDER": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "VEHICLE_HISTORY_SUMMARY": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    },
    "open_itemsCounts": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "INVOICE",
            "CREDIT_MEMO",
            "PAYMENT",
            "REFUND",
            "REMINDER_FEE"
          ],
          "properties": {
            "INVOICE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "CREDIT_MEMO": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "PAYMENT": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "REFUND": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            },
            "REMINDER_FEE": {
              "type": "integer",
              "minimum": 0,
              "maximum": 2147483647
            }
          }
        }
      ]
    }
  }
}
```

Cross-field checks, in addition to the schema:

- `source_system == source_name + ':' + source_company_code`; context must match the approved company/legal-entity assignment. Unsupported format_version fails before row parsing. Rehearsals may be extracted before cutover; do not require extracted_at and cutover_date to coincide.
- `files[].name` is unique. Actual file set equals that list. SHA-256 is lowercase hex over **exact received bytes**, including BOM/line endings if present, before decoding/normalization. No self-hash for manifest; persist a SHA-256 of its original bytes separately with the future migration run.
- Parse each CSV with the contract rules; computed logical count must equal row_count. counts_by_type must contain exactly each listed CSV basename without `.csv`, and the corresponding count must equal row_count. Counts are **supplied rows before GDPR skips or target apply actions**, not CREATE counts. Document-type-specific row counts are carried separately in document_totals.
- stock_value is null iff stock_opening.csv is absent; otherwise it is a string including `0.00` for an empty file. Recompute with the row-rounding rule above. open_items follows the same null/absence rule and uses signed outstanding receivables (credit balances negative). Historical INVOICE and CREDIT_MEMO document totals are separate positive-magnitude buckets by original document year-month; credits are not negated twice. For each bucket gross = net + vat. Only original source amounts are totaled; do not recompute historical VAT from today's rates.
- document_totals must be empty if legacy_documents.csv is absent or contains no INVOICE/CREDIT_MEMO rows. Otherwise there must be exactly one bucket per present `(year_month, doc_type)`, with its exact count and sums; no missing, duplicate or extra bucket. History/open-item validation follows AUT-650 and still requires installed handler/storage capabilities. No unsupported file can pass on the strength of declared totals alone.
- Hash/count/enum/header/reference/control-total mismatch blocks dry-run acceptance/apply. Report expected and actual totals with no tolerance; currency is EUR throughout. Keep separate bundles if a source company has unsupported non-EUR balances; no implicit conversion or mixed-currency summation.


- `control_totals.domain_counts` has exactly the eight schema-listed domains. Each value is null iff its CSV is absent, otherwise a complete enum map with zeroes for unused values. Sum of each map equals its CSV row_count (vehicle role, due kind, notice type, tyre status, order kind, line kind, history doc_type, open-item doc_type respectively). A present empty file has a full zero map, never null. Customer restrictions and skipped/partially invoiced orders do not reduce supplied counts.
- `open_items_as_of` is null iff open_items.csv is absent; otherwise it is the actual snapshot business date, even for an empty snapshot, and every balance_as_of equals it. It cannot postdate extraction business date or cutover. Final cutover requires explicit freeze/bridge evidence, not relabeling a rehearsal snapshot.
- `open_orders_net` is null iff open_orders.csv is absent; otherwise exact sum of supplied expected_net_total before skips. Validate corresponding complete task/line graph under AUT-649. There is no new accounting revenue event.
- `assets` is empty unless legacy documents reference source PDFs. Asset names must be unique and disjoint from CSV names. Actual bundle members equal manifest.json + files[].name + assets[].name. Verify exact PDF byte size/hash/type, all references and no orphan entries; asset publication follows AUT-650 retention/hold rules. The manifest itself and assets never add to counts_by_type.

### Synthetic, internally consistent minimal bundle

An empty customers.csv proves file integrity/count behavior without embedding personal data. It is a **header-only staged bundle**, not a successful dealership migration. Generate its exact bytes as the table-ordered customer header joined with commas, followed by CRLF. The example generator below is explanatory Python, not a product-code addition; it computes the hash rather than publishing a fabricated checksum.

```python
import hashlib
import json

header = (
    "external_id,type,company_name,first_name,last_name,email,phone,vat_id,"
    "address_street,address_zip,address_city,address_country,salutation,title,"
    "title_suffix,letter_salutation,block_level,block_reason,payment_terms_days,"
    "payment_terms_text,bill_to_external_id,labor_price_group_code,last_activity_date,"
    "has_open_matters,privacy_objection,mail_stop,anonymized\r\n"
)
csv_bytes = header.encode("utf-8")
manifest = {
    "format_version": "1.1",
    "source_name": "incadea",
    "source_system": "incadea:sample_company",
    "source_company_code": "sample_company",
    "extracted_at": "2026-10-19T08:00:00Z",
    "cutover_date": "2026-11-01",
    "currency": "EUR",
    "files": [{"name": "customers.csv", "sha256": hashlib.sha256(csv_bytes).hexdigest(), "row_count": 0}],
    "assets": [],
    "control_totals": {"counts_by_type": {"customers": 0}, "stock_value": None, "open_items": None, "document_totals": [], "open_orders_net": None, "open_items_as_of": None, "domain_counts": {name: None for name in ["vehicle_parties", "vehicle_due_dates", "vehicle_notices", "tyre_sets", "open_orders", "open_order_lines", "legacy_documents", "open_items"]}}
}
manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
```

Nonempty fixtures in AUT-645 must cover umlauts, quoted commas/quotes/multiline descriptions, leading-zero IDs, zero vs blank money, duplicate normalized emails, missing/invalid VIN, shared plates, bill-to chains, restrictions and two makes sharing a labor code. Later files add split-billed/goodwill examples when their contracts are complete.

## Database Impact

No table/column/migration is added by AUT-621. Existing ExternalIdMapping is reused; this file contract does not claim all new domains already fit today's ImportEntityType or handlers.

| Target change / gap | Owning implementation |
|---|---|
| Customer restriction/block/salutation/payment/bill-to/price-group fields; LaborPriceGroup and fitment time override | AUT-624, behavior AUT-632/638/639/637 |
| Vendor address columns are absent today; original labor code field is absent today | AUT-625 and AUT-637 must explicitly resolve storage/migration prerequisites before accepting nonempty affected values. Existing string-backed canonical fields are not silently discarded. |
| Parts core attributes and vendor links; opening ledger behavior | AUT-625/626; core invoicing AUT-644 |
| Package/version/item schema and import identity | AUT-643 |
| Legacy history, grouped runs and later vehicle domains | AUT-628/641 and their importer tickets |

No deletion rules or state machines change in this spec. Implementations introducing entities must extend [deletion policy](../../../deletion-policy.md), retention and tenant-restore contracts. Replay never grants permission to delete. The 180-day import-row purge cannot erase retained legacy evidence required by ADR-0031.

## API Contract Changes

No endpoint, DTO, Swagger metadata or generated OpenAPI artifact changes here. AUT-645 defines the upload validator/preset integration; future API shape changes require OpenAPI and frontend-type regeneration. Filename/schema acceptance is independent of an installed handler's capability; report a blocking unsupported capability rather than partially applying a bundle.

## UX Compliance and Component Design

No new page, component, auto-save flow, status or realtime event is introduced. Use the existing Settings → Data import wizard. The future “Canonical migration CSV v1” preset maps the **existing customer/vehicle/labor fields 1:1** using English headers; extra fields require the relevant handlers. The current supplier-price-list preset remains for its existing workflow and does not turn a supplier price list into parts/opening-stock migration. Its unrelated German-header/semicolon templates remain valid outside the canonical boundary.

AUT-645 initially supports only implemented file/column capabilities, validates before dry-run, and reports unsupported nonempty semantics explicitly. A core validator can validate the complete defined dictionaries without pretending schema/handler prerequisites have shipped. Domain import tickets extend fixtures and the preset as capabilities land; no silent data loss or arbitrary source header mapping.

## Testing Plan

Documentation verification: parse/check the embedded JSON Schema with a Draft 2020-12 validator, execute the synthetic example in memory and validate its manifest/hash/header/count, check local links and whitespace. No runtime implementation/tests are added in this ticket.

AUT-645 must use TDD for schema + semantic validators and include:

- Positive full defined-file fixtures, header-only/missing-file distinction, CRLF/LF/BOM hashes and RFC 4180 embedded newlines.
- Hash mismatch, logical-row mismatch, missing/unknown/reordered/duplicate header, malformed UTF-8/quoting, duplicate JSON keys, source namespace mismatch and unknown version/enum.
- Exact decimal parsing/ranges, negative/overflow stock, explicit zero, stock rounding and mismatch, null-vs-zero totals, duplicate/missing history bucket and duplicate filenames. Netness of numeric prices and the source time-unit basis require extractor/rehearsal evidence; a syntactically valid number cannot prove conversion. Test verified conversion examples separately, not an invented gross-price detector.
- Tenant/site/legal-entity isolation; same external ID in different company namespaces; matching conflicts; duplicate SKU/VIN/email; stable leading-zero IDs.
- GDPR year boundaries/leap day, anonymized skip, old open matters with restriction, bill-to references to skipped parties, no consent creation; unknown/personal-data columns rejected.
- Two make-colliding labor codes, migrated vehicle engine_code selecting an engine-qualified time (and an unsupported vehicle-handler case), standard-time overlap, unsupported model/unit conversion, invalid/cyclic references, package validity/item invariants; partial/unsupported bundle fails before apply.
- Existing import regression tests and `test/legacy-import.e2e-spec.ts` fixture CREATE/SKIP/ERROR/WARNING counts, plus replay with no duplicate stock/package/history effects as each handler ships.

## Open Questions and Release Gates

There are no open **wire-format choices** for AUT-645's defined subset. Source unit conversion, export rights, real field coverage, namespace/site assignments, DPA and legal/fiscal readiness require rehearsal evidence (AUT-390/391/634), not guessed defaults. Product Owner acceptance establishes the specification baseline; implementation follows the repository's normal planning/TDD/review workflow, and production use remains gated on the required evidence.

The AUT-647/648/649/650 dictionaries are complete in revision 1.1; import still requires the named target schemas, capabilities and validation tests. Vendor-address/original-labor-code storage and dealer-stock activation are explicit implementation prerequisites, not reasons to drop canonical values. A full cutover remains blocked on all ADR-0031 gates.

## References and Linear Tracking

- [AUT-621](https://linear.app/auto-core-platform/issue/AUT-621) — specification; [AUT-645](https://linear.app/auto-core-platform/issue/AUT-645) — validator, fixtures and preset.
- [Legacy import](legacy-import.md); [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md); [ADR-0023](../../01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md).
- [AUT-624](https://linear.app/auto-core-platform/issue/AUT-624), [AUT-625](https://linear.app/auto-core-platform/issue/AUT-625), [AUT-626](https://linear.app/auto-core-platform/issue/AUT-626), [AUT-632](https://linear.app/auto-core-platform/issue/AUT-632), [AUT-637](https://linear.app/auto-core-platform/issue/AUT-637), [AUT-638](https://linear.app/auto-core-platform/issue/AUT-638), [AUT-639](https://linear.app/auto-core-platform/issue/AUT-639), [AUT-643](https://linear.app/auto-core-platform/issue/AUT-643) — core domain owners.
- Source of current ACP behavior: `apps/core-api/prisma/schema.prisma`, `src/import/import.templates.ts`, `src/import/import.types.ts`, `src/import/csv-parse.util.ts`, `src/labor/dto/labor-operation.dto.ts`, `src/workshop/workshop-catalog-line.service.ts` under core-api. Source-system internals are not part of this contract.
