---
title: "Damage estimate import (Audatex BMS 5.7.0)"
date: "2026-10-15"
module: "Workshop"
status: draft
linear-project: "https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b"
linear-milestone: "M5 Snap & Done and vehicle enrichment"
tags:
  - feature-spec
  - workshop
  - import
  - estimate
---

# Damage estimate import (Audatex BMS 5.7.0)

## Summary

A service advisor uploads one Audatex accident-damage estimate and reviews it as workshop task lines before anything is written. The file is the Audatex Estimate Return document: CIECA BMS version **5.7.0**, root `VehicleDamageEstimateAddRq`. The dry-run shows VIN, estimate identity, parts, labour hours, Arbeitswerte, discounts, markups, and provenance. Apply writes lines only after the advisor confirms, and it never rewrites a sent or approved Kostenvoranschlag. A revision is a new `DRAFT` version under the same estimate number. Parser tests run on the synthetic fixture in this spec. Insurer submission, a live provider call, DAT, and licence procurement are out of scope. Architecture: [ADR-0029](../../01-ADR/2026-10-15-audatex-bms-damage-estimate-import.md).

---

## User Stories

- As a **service advisor**, I want to **upload one Audatex BMS 5.7.0 estimate onto an open workshop order** so that **I can check the proposed parts and labour before they touch the order**.
- As a **service advisor**, I want **unreadable files, unknown versions, unknown units, and a VIN that is not the order vehicle to stop the import** so that **a bad file cannot become billable lines**.
- As a **service advisor**, I want **an approved Kostenvoranschlag to stay as the customer accepted it** so that **a second upload cannot change that price unless I create a revision on purpose**.

---

## Decisions

| ID | Decision |
| --- | --- |
| D1 | First slice is the **uploaded XML document** Audatex returns as `claimXml` (CIECA BMS **5.7.0**). No HTTP call to Audatex, Solera, CIECA, or DAT. |
| D2 | DAT is not implemented. The current DAT calculation schema is the login-gated Schnittstellen-Kompendium named in newsletter 051 (31 July 2015). That missing contract is recorded under [Missing official contracts](#missing-official-contracts). |
| D3 | The CSV import templates stay unchanged. `DAMAGE_ESTIMATE` is a new `ImportEntityType` on the existing `ImportJob`. `GET /api/imports/templates/DAMAGE_ESTIMATE` returns **404**. |
| D4 | The target is an existing workshop order and one of its tasks. The import does not create a customer, a vehicle, an order, or a Kostenvoranschlag. |
| D5 | Tenant comes from the authenticated session. Site comes from the active membership (`resolveEstimateScope`). The file does not choose the site. The order's `site_id` must equal that site. |
| D6 | Roles are `OWNER`, `ADMIN`, and `SALES`, the same set as `assertEstimateRole`. Every other role receives **403** `ESTIMATE_ROLE_FORBIDDEN`. |
| D7 | Labour quantity on the line is **hours**, matching `WorkshopCatalogLineService.buildLaborLine`. `standard_aw` is derived with the tenant `CatalogProviderSettings.aw_minutes` (schema default **6** when the settings row is absent). |
| D8 | Money and hours use half-up rounding. Currency and `standard_aw` use 2 decimal places. `quantity` uses 3 decimal places. A file amount and a computed amount conflict when they differ by more than **0.01**. |
| D9 | Tax totals are not read from the file. The public line fragment has `TaxableInd` and no tax-total element. Lines store net `unit_price`. The existing estimate snapshot applies tenant tax at send. |
| D10 | `OtherChargesInfo` and `AdjustmentType` `Betterment` do not become lines in this slice. They are review blockers. |
| D11 | Apply is one database transaction. Any review blocker rejects the whole apply. There is no partial write. |
| D12 | A sent or approved estimate version row is never updated. `create_revision: true` inserts one new `DRAFT` with the same guards as `WorkshopEstimateService.createRevision` and does not send it. |
| D13 | This slice adds no agent tool and does not enqueue `AgentProposal`. |

---

## Document contract

### Public sources

| Source | What it establishes |
| --- | --- |
| Audatex / Solera, [Estimate Document Return API Integration Guide](https://na.api.solera.com/files/Estimate%20Return%20API.pdf) | The Estimate Return message **is version 5.7.0**. The client converts CIECA BMS XML. The guide's sample envelope is JSON with `dataType` `XML.Base64` and is **not** the document this slice parses. |
| [CIECA Estimate Service](https://www.cieca.com/Services/estimate-service) | Schema file names for the Estimate service. The bytes are a member download. |
| [Public BMS fragment](https://stackoverflow.com/questions/68761455/lateral-flatten-outer-on-xml-file-does-not-work) (12 August 2021) | Root `VehicleDamageEstimateAddRq`, namespace `http://www.cieca.com/BMS`, and the line elements used below. It has **no** `DocumentInfo` and **no** VIN, so it is not an acceptable upload. |
| [CCC Secure Share BMS field list](https://www.cccsecureshare.com/legal/limitedpartsmessages) | Paths `DocumentInfo/BMSVer`, `DocumentInfo/DocumentID`, `DocumentInfo/DocumentVer/*`, `VehicleInfo/VINInfo/VIN/VINNum`, `PartInfo/PriceAdjustment/*`. CCC's own writer hardcodes BMS **5.4.0**. This slice accepts only **5.7.0**. |

The synthetic fixture below uses those published element names and **synthetic** values. It does not copy the part numbers, descriptions, or amounts from the public fragment.

### Missing official contracts

These contracts are **not** in the repository and are **not** invented here:

1. **CIECA BMS 5.7.0 schema bytes**: `BMSCommonGlobalTypes.xsd`, `BMSEstimateCommonTypes.xsd`, `BMSEstimateMessages.xsd`, `BMSEstimateService.xsd`, named on the CIECA Estimate Service page and behind CIECA member login. The Audatex guide points integrators at that schema.
2. **Audatex Estimate Return Data Mapping appendix**, cited in section 6.1 of the Estimate Document Return guide. The public guide states version 5.7.0 and that Audatex does not emit every BMS field. It does not publish the field-by-field appendix retrieved for this spec.
3. **DAT Schnittstellen-Kompendium** (myDAT, customer login). DAT newsletter 051 (31 July 2015) says the compendium moved behind that login. The public DATGROUP GitHub organisation no longer contains the example repository that newsletter linked.

Until (1) or (2) is obtained without a production credential, the parser reads **only** the paths in the mapping table. Any other child of `DamageLineInfo` blocks that line.

### Accepted root

- Namespace `http://www.cieca.com/BMS`.
- Local root name `VehicleDamageEstimateAddRq`.
- `DocumentInfo/BMSVer` text is exactly `5.7.0`.
- `DocumentInfo/DocumentType` text is exactly `E`.
- `DocumentInfo/DocumentID` is 1–64 characters from `A-Z`, `a-z`, `0-9`, and `-`.
- `DocumentInfo/DocumentVer/DocumentVerCode` is `EM` or `SV`.
- `DocumentInfo/DocumentVer/DocumentVerNum` is an integer 0–99.
- `VehicleInfo/VINInfo/VIN/VINNum` is 17 letters or digits.
- At least one `DamageLineInfo`.
- No `DOCTYPE`. The parser must not resolve external entities and must not open a network connection.
- At most 500 `DamageLineInfo` elements. Above that the file is rejected as corrupt for this slice.
- File size limit is the existing `IMPORT_MAX_FILE_BYTES` (10 MiB).

`RqUID` is stored as message provenance when present. It is not the estimate id. A resent message keeps the same `RqUID` in the BMS description, so it cannot separate two estimate versions.

---

## Field mapping

Provenance on every proposed and applied line is the JSON object `import_provenance` (column defined under Database Impact). `source_system` on the line is always `AUDATEX_BMS`.

Document key, and `ExternalIdMapping.external_id`: `document_id + "|" + document_ver_code + "|" + document_ver_num`. Example: `SYN-EST-1001|EM|0`. A supplement keeps the same `DocumentID` and gets its own key, so the original mapping row stays.

| BMS path | Local field | Rule |
| --- | --- | --- |
| `DocumentInfo/DocumentID` | `import_provenance.document_id` | Estimate / damage document id. Required. It is not the `ExternalIdMapping` key by itself. |
| `DocumentInfo/BMSVer` | `import_provenance.bms_version` | Must be `5.7.0`. |
| `DocumentInfo/DocumentVer/DocumentVerCode` | `import_provenance.document_ver_code` | `EM` original, `SV` supplement. |
| `DocumentInfo/DocumentVer/DocumentVerNum` | `import_provenance.document_ver_num` | Integer 0–99. |
| `RqUID` | `import_provenance.rq_uid` | Optional. Not an idempotency key. |
| `VehicleInfo/VINInfo/VIN/VINNum` | Compared to `WorkshopOrder.vehicle.vin` | Exact match after uppercasing both sides. No vehicle is created. |
| `DamageLineInfo/LineNum` | `import_provenance.line_num` | Display order. Rows are sorted by `LineNum`, then kind order part, body labour, refinish. |
| `DamageLineInfo/UniqueSequenceNum` | `import_provenance.unique_sequence_num` | Stable line id across versions. Required on every line that is mapped or blocked. Missing value blocks that line with `LINE_IDENTITY_MISSING`. |
| `DamageLineInfo/LineDesc` | `description` | Trimmed, 1–500 characters. Empty description blocks the line with `LINE_DESC_MISSING`. |
| `DamageLineInfo/ParentLineNum` | `import_provenance.parent_line_num` | Stored only. Lines stay flat. Absent means null. |
| `DamageLineInfo/SupplementNum` | `import_provenance.supplement_num` | Stored only. Recognized so it is not `UNMAPPABLE_ELEMENT`. |
| `DamageLineInfo/EstimateVerCode` | `import_provenance.estimate_ver_code` | Stored only. Same treatment. |
| `DamageLineInfo/ManualLineInd` | `import_provenance.manual_line` | Stored only. Same treatment. |
| `DamageLineInfo/AutomatedEntry` | `import_provenance.automated_entry` | Stored only. Present on the 12 August 2021 fragment. |
| `DamageLineInfo/LineStatusCode` | `import_provenance.line_status_code` | Stored only. Present on that fragment. |
| `DamageLineInfo/DescJudgmentInd` | `import_provenance.desc_judgment` | Stored only. Present on that fragment and the CCC field list. |
| `PartInfo/PartNum` | `item_no` | Part line. Required when `PartInfo` is billable. |
| `PartInfo/OEMPartNum` | `oem_numbers` | JSON array of one string, or omitted when absent. |
| `PartInfo/PartType` | `import_provenance.part_type` | One of `PAA`, `PAG`, `PAL`, `PAM`, `PAN`, `PAND`, `PAO`, `PAP`, `PAR`. Any other value blocks the line with `UNKNOWN_PART_TYPE`. |
| `PartInfo/Quantity` | `quantity` | Decimal greater than 0, up to 3 decimal places. |
| `PartInfo/UnitPartPrice` | Price input | Net unit is this value after a confirmed discount or markup. |
| `PartInfo/PartPrice` | Check only | Must equal `UnitPartPrice * Quantity` within 0.01. Otherwise `PRICE_UNIT_CONFLICT`. |
| `PartInfo/PriceInclInd` | Skip | `true` produces a `SKIP` row and no line. |
| `PartInfo/TaxableInd` | `import_provenance.taxable` | Required on a billable part. `true` or `false`. Missing or any other text blocks the line with `TAXABLE_FLAG_MISSING`. |
| `LaborInfo/TaxableInd` | `import_provenance.taxable` on the body-labour line | Required. The 12 August 2021 fragment includes it. Missing or any other text blocks that labour line with `TAXABLE_FLAG_MISSING`. |
| `RefinishLaborInfo/TaxableInd` | `import_provenance.taxable` on the refinish line | Optional. The public fragment does not include it. Present `true` or `false` is stored and `taxable_source` is `element`. Absent means `taxable` false and `taxable_source` `absent`. Any other text blocks the refinish line with `TAXABLE_FLAG_MISSING`. |
| `PartInfo/PriceAdjustment/AdjustmentType` | Discount, markup, or blocker | `Discount` and `Markup` change the proposed unit. `Betterment` blocks with `BETTERMENT_REVIEW`. |
| `PartInfo/PriceAdjustment/AdjustmentPct` and `AdjustmentAmt` | Proposed `unit_price` | Both required together for Discount and Markup. They must agree within 0.01: `AdjustmentAmt = UnitPartPrice * Quantity * AdjustmentPct / 100`. Discount proposed unit = `UnitPartPrice * (1 - AdjustmentPct/100)`. Markup proposed unit = `UnitPartPrice * (1 + AdjustmentPct/100)`. Proposed extended = proposed unit * quantity. |
| `LaborInfo` | One `LABOR` line, kind `BODY_LABOR` | `LaborType` must be `LAB`. |
| `RefinishLaborInfo` | One `LABOR` line, kind `REFINISH_LABOR` | `LaborType` must be `LAR`. Description is `LineDesc` plus ` (refinish)`. |
| `LaborHours` | `quantity`, `actual_hours` | Hours, 3 decimal places. `actual_hours` stores the same hours at 2 decimal places when the value fits; a third decimal blocks the line with `AW_PRECISION` because `actual_hours` and `standard_aw` are `Decimal(10, 2)`. The happy fixture uses one decimal hour, which fits. |
| `LaborAmt` | Check and rate | When hours are greater than 0, proposed `unit_price` = `LaborAmt / LaborHours` rounded half-up to 2 decimals. Re-multiplying that unit by the hours must land within 0.01 of `LaborAmt`. Otherwise `PRICE_UNIT_CONFLICT`. |
| `LaborOperation` | `item_no`, `external_operation_code` | Required for a billable labour line. |
| `LaborInclInd` | Skip or blocker | `true` with hours `0` and amount `0` is a `SKIP` row (`INCLUDED`). Any other combination blocks with `INCLUDED_LINE_CONFLICT`. |
| `CatalogProviderSettings.aw_minutes` | `standard_aw` | `standard_aw = hours * (60 / aw_minutes)`, half-up to 2 decimals. Missing settings row uses **6**. A present value of 0 or less blocks the document with `INVALID_AW_MINUTES`. |
| `LaborCategory` | `labor_category_id`, `hourly_rate_snapshot`, `internal_cost_rate` | `CatalogProviderSettings.default_labor_category_id`, active, with `default_hourly_rate` not null. Otherwise the document blocker is `LABOR_CATEGORY_MISSING`. When that rate differs from the proposed unit by more than 0.01, the line blocks with `LABOR_RATE_CONFLICT` until apply sends `rate_choice: "ESTIMATE_RATE"`. The written `unit_price` and `hourly_rate_snapshot` are then the estimate rate. `CATEGORY_RATE` is not a choice in this slice, because it would replace the estimate price. |
| `CatalogItem.sku = PartNum` | `catalog_item_id` | When a tenant item exists and its selling price equals the proposed unit within 0.01, link it. When the prices differ, block with `CATALOG_PRICE_CONFLICT` until apply sends `price_choice: "ESTIMATE_PRICE"`. The written unit stays the estimate unit and the catalog item is linked. `CATALOG_PRICE` is not a choice in this slice. |
| `OtherChargesInfo` | No line | Blocker `OTHER_CHARGE_UNMAPPED`. The public fragment does not say whether `Price` is a unit price or an extended price. |
| `OtherChargesInfo/UnitOfMeasure` other than `HR` | No line | Blocker `UNKNOWN_UNIT`, in addition to `OTHER_CHARGE_UNMAPPED` when the element exists. The only unit published on that element in the public fragment is `HR`. Part quantities have no unit element. Labour hours have no separate unit element; they are hours. |
| Any other element child of `DamageLineInfo` | No line | Blocker `UNMAPPABLE_ELEMENT` naming the local element name. |
| A second `PartInfo`, `LaborInfo`, `RefinishLaborInfo`, or `OtherChargesInfo` on one line | No line | Blocker `DUPLICATE_ELEMENT`. |

Part line columns that labour does not use: `type = PART`, `part_execution_status = PENDING_PICK`, `catalog_item_id` as above or null, `standard_aw` null, `actual_hours` null, `labor_category_id` null, `hourly_rate_snapshot` null, `external_operation_code` null.

Labour line columns: `type = LABOR`, `part_execution_status` null, `catalog_item_id` null, `oem_numbers` null.

Neither line writes `InventoryTransaction`, `PartsReservation`, or a catalog price history. Stock moves later, through the existing pick flow.

Kind order on one BMS line is `PART`, then `BODY_LABOR`, then `REFINISH_LABOR`. The match key of an applied line is `(document_id, document_ver_code, document_ver_num, unique_sequence_num, kind)`.

---

## Synthetic fixture

Assumption for the expected Arbeitswerte: `aw_minutes = 6`, so one hour is 10.00 AW. The labour category selling rate is **80.00**, equal to every labour unit rate in the file, so the happy file has no `LABOR_RATE_CONFLICT`. No `CatalogItem` matches `SYN-PART-1` or `SYN-PART-2`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<VehicleDamageEstimateAddRq xmlns="http://www.cieca.com/BMS">
  <RqUID>00000000-0000-4000-8000-000000000001</RqUID>
  <DocumentInfo>
    <BMSVer>5.7.0</BMSVer>
    <DocumentType>E</DocumentType>
    <DocumentID>SYN-EST-1001</DocumentID>
    <DocumentVer>
      <DocumentVerCode>EM</DocumentVerCode>
      <DocumentVerNum>0</DocumentVerNum>
    </DocumentVer>
  </DocumentInfo>
  <VehicleInfo>
    <VINInfo>
      <VIN>
        <VINNum>SYNTH0DAMAGE00001</VINNum>
      </VIN>
    </VINInfo>
  </VehicleInfo>
  <DamageLineInfo>
    <LineNum>1</LineNum>
    <UniqueSequenceNum>10</UniqueSequenceNum>
    <SupplementNum>0</SupplementNum>
    <EstimateVerCode>EM</EstimateVerCode>
    <ManualLineInd>false</ManualLineInd>
    <LineDesc>Synthetische Stossstange instandsetzen</LineDesc>
    <LaborInfo>
      <LaborType>LAB</LaborType>
      <LaborOperation>OP-SYN-1</LaborOperation>
      <LaborHours>1.2</LaborHours>
      <LaborInclInd>false</LaborInclInd>
      <LaborAmt>96.00</LaborAmt>
      <TaxableInd>false</TaxableInd>
    </LaborInfo>
  </DamageLineInfo>
  <DamageLineInfo>
    <LineNum>2</LineNum>
    <UniqueSequenceNum>11</UniqueSequenceNum>
    <SupplementNum>0</SupplementNum>
    <EstimateVerCode>EM</EstimateVerCode>
    <ManualLineInd>false</ManualLineInd>
    <LineDesc>Synthetische Stossstangenverkleidung</LineDesc>
    <PartInfo>
      <PartType>PAN</PartType>
      <PartNum>SYN-PART-1</PartNum>
      <OEMPartNum>SYN-OEM-1</OEMPartNum>
      <PartPrice>200.00</PartPrice>
      <UnitPartPrice>200.00</UnitPartPrice>
      <TaxableInd>true</TaxableInd>
      <PriceInclInd>false</PriceInclInd>
      <Quantity>1</Quantity>
      <PriceAdjustment>
        <AdjustmentType>Discount</AdjustmentType>
        <AdjustmentPct>10</AdjustmentPct>
        <AdjustmentAmt>20.00</AdjustmentAmt>
      </PriceAdjustment>
    </PartInfo>
    <LaborInfo>
      <LaborType>LAB</LaborType>
      <LaborOperation>OP-SYN-SKIP</LaborOperation>
      <LaborHours>0</LaborHours>
      <LaborInclInd>true</LaborInclInd>
      <LaborAmt>0</LaborAmt>
      <TaxableInd>false</TaxableInd>
    </LaborInfo>
    <RefinishLaborInfo>
      <LaborType>LAR</LaborType>
      <LaborOperation>OP-SYN-2</LaborOperation>
      <LaborHours>0.5</LaborHours>
      <LaborInclInd>false</LaborInclInd>
      <LaborAmt>40.00</LaborAmt>
      <TaxableInd>false</TaxableInd>
    </RefinishLaborInfo>
  </DamageLineInfo>
  <DamageLineInfo>
    <LineNum>3</LineNum>
    <UniqueSequenceNum>12</UniqueSequenceNum>
    <SupplementNum>0</SupplementNum>
    <EstimateVerCode>EM</EstimateVerCode>
    <ManualLineInd>false</ManualLineInd>
    <LineDesc>Synthetischer Halter</LineDesc>
    <PartInfo>
      <PartType>PAN</PartType>
      <PartNum>SYN-PART-2</PartNum>
      <PartPrice>100.00</PartPrice>
      <UnitPartPrice>100.00</UnitPartPrice>
      <TaxableInd>true</TaxableInd>
      <PriceInclInd>false</PriceInclInd>
      <Quantity>1</Quantity>
      <PriceAdjustment>
        <AdjustmentType>Markup</AdjustmentType>
        <AdjustmentPct>5</AdjustmentPct>
        <AdjustmentAmt>5.00</AdjustmentAmt>
      </PriceAdjustment>
    </PartInfo>
  </DamageLineInfo>
</VehicleDamageEstimateAddRq>
```

### Expected local lines

Tax is not an amount in this result. `taxable_net` is the sum of line nets whose provenance `taxable` is true.

| # | kind | type | item_no | description | quantity | unit_price | standard_aw | actual_hours | line_net | taxable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | BODY_LABOR | LABOR | OP-SYN-1 | Synthetische Stossstange instandsetzen | 1.200 | 80.00 | 12.00 | 1.20 | 96.00 | false |
| 2 | PART | PART | SYN-PART-1 | Synthetische Stossstangenverkleidung | 1.000 | 180.00 |  |  | 180.00 | true |
| 3 | REFINISH_LABOR | LABOR | OP-SYN-2 | Synthetische Stossstangenverkleidung (refinish) | 0.500 | 80.00 | 5.00 | 0.50 | 40.00 | false |
| 4 | PART | PART | SYN-PART-2 | Synthetischer Halter | 1.000 | 105.00 |  |  | 105.00 | true |

`SYN-PART-1` provenance records `source_unit_price` `200.00`, `adjustment_type` `Discount`, `adjustment_pct` `10`, `adjustment_amt` `20.00`. `SYN-PART-2` records `Markup`, `5`, `5.00`. Labour provenance records `source_extended` `96.00` and `40.00`. Both labour lines have `TaxableInd` `false`, so `taxable` is false and `taxable_source` is `element`. `SupplementNum`, `EstimateVerCode`, and `ManualLineInd` are stored on each line and do not block it. A refinish line with no `TaxableInd` is still billable, with `taxable` false and `taxable_source` `absent`.

Review totals: `line_net` **421.00**, `taxable_net` **285.00**, `non_taxable_net` **136.00**, `tax_amount` **null**. One `SKIP` row: line 2 body labour, reason `INCLUDED`, no local line.

`oem_numbers` on line 2 is `["SYN-OEM-1"]`. Line 4 has no `oem_numbers`. `part_execution_status` on both parts is `PENDING_PICK`.

### Rejection and review fixtures

Each case is the happy document with one change, unless noted.

| Case | Change | Result |
| --- | --- | --- |
| Unknown version | `BMSVer` is `5.4.0` | **422** `UNKNOWN_VERSION`. No `ImportJob`. |
| Unknown version | `DocumentInfo` omitted, as in the public fragment | **422** `UNKNOWN_VERSION`. No `ImportJob`. |
| Corrupt file | The root end tag is missing | **422** `CORRUPT_FILE`. No `ImportJob`. |
| Corrupt file | A `DOCTYPE` is present | **422** `CORRUPT_FILE`. No entity is resolved. No `ImportJob`. |
| Unsupported document | Root local name is `AssignmentAddRq` | **422** `UNSUPPORTED_DOCUMENT`. No `ImportJob`. |
| Unknown vehicle | `VINNum` is `SYNTH0DAMAGE00002` while the order vehicle VIN is `SYNTH0DAMAGE00001` | **201** job. Document blocker `VEHICLE_MISMATCH`. Apply returns **409** `APPLY_BLOCKED` and writes no line. |
| Unknown vehicle identity | `VINNum` omitted or not 17 letters/digits | **422** `VEHICLE_IDENTITY_INVALID`. No `ImportJob`. |
| Unknown unit | Add `OtherChargesInfo` with `UnitOfMeasure` `AW`, `Price` `12.50`, `Quantity` `0.5`, `OtherChargesType` `MAPA` on line 3 | **201** job. That line has blockers `UNKNOWN_UNIT` and `OTHER_CHARGE_UNMAPPED`. Apply returns **409** `APPLY_BLOCKED`. |
| Closed order | Order status is `COMPLETED` or `INVOICED` | **409** `ORDER_NOT_OPEN`. No `ImportJob`. |

`SCHEDULED` is also refused with `ORDER_NOT_OPEN`. The open statuses are `WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES`: `INTAKE` and `IN_PROGRESS`.

---

## Dry-run, repeat, and apply

### Upload

`POST /api/imports/damage-estimates`

Multipart fields:

| Field | Rule |
| --- | --- |
| `file` | The XML document. Required. |
| `workshopOrderId` | UUID of the order in the session tenant and active site. Required. |
| `taskId` | UUID of a task on that order. Required. |

The handler loads the order, its vehicle VIN, the task, the latest estimate version, the task lines, and `CatalogProviderSettings` in one read. It does not query inside a loop over lines.

An unknown order in this tenant and site is **404** `ORDER_NOT_FOUND`. A task that is not on that order is **404** `TASK_NOT_FOUND`. An order whose `site_id` is null or is not the active site is **409** `ORDER_SITE_MISMATCH`. A file over 10 MiB is **422** `FILE_TOO_LARGE`. None of these insert a job.

When the file fails a rejection rule above, the response is the 422 or 409 in the table and nothing is inserted.

Otherwise the response is **201** with the import job. `status` is `DRY_RUN_DONE`. `entity_type` is `DAMAGE_ESTIMATE`. `source_system` is `AUDATEX_BMS`. `file_sha256` is the SHA-256 of the raw bytes. `mapping_json` is `{ "map_version": "bms-5.7.0-audatex-estimate-return-v1", "document_key": "SYN-EST-1001|EM|0" }`. `options_json` stores `workshop_order_id`, `task_id`, `document_id`, `document_ver_code`, `document_ver_num`, and `line_items_version` captured at dry-run. `totals_json` stores the review totals, blocker codes, and row counts.

Each proposed local line and each `SKIP` or blocked BMS element is one `ImportJobRow`. `normalized_json` holds the proposed line, including `import_provenance`. `errors_json` holds blocker codes. `action` is `CREATE`, `SKIP`, or `ERROR`.

Dry-run does not insert task lines, does not increment `line_items_version`, does not create an estimate version, and does not write `ExternalIdMapping`.

### Repeat

Look up an existing job for the same tenant, `DAMAGE_ESTIMATE`, `AUDATEX_BMS`, and `mapping_json.document_key`, with status `DRY_RUN_DONE`, `APPLYING`, or `APPLIED`.

| Existing job | New bytes | Result |
| --- | --- | --- |
| Same `file_sha256` | Same | **200** and that job. No second job. No line write. |
| Different `file_sha256` | Different | **409** `DOCUMENT_VERSION_CONFLICT`. The existing job and the order stay as they are. |
| None | Any accepted file | **201** new dry-run. |

`FAILED` and `CANCELLED` jobs do not take part in this lookup. This slice does not offer a cancel endpoint.

A supplement is a different document key (`SV` or a higher `DocumentVerNum`). It is a new dry-run. It is not merged in silence.

### Apply

`POST /api/imports/:id/apply`

Body:

```json
{
  "expected_line_items_version": 0,
  "create_revision": false,
  "accept_price_changes": false,
  "rate_choice": "ESTIMATE_RATE",
  "price_choice": "ESTIMATE_PRICE"
}
```

`expected_line_items_version` is required. `create_revision` and `accept_price_changes` default to false. `rate_choice` is required only when a row has `LABOR_RATE_CONFLICT` and is otherwise omitted. `price_choice` is required only when a row has `CATALOG_PRICE_CONFLICT` and is otherwise omitted. The only accepted values are `ESTIMATE_RATE` and `ESTIMATE_PRICE`.

Apply loads the job in the session tenant. A job already `APPLIED` returns **200** with the same payload and does not write again.

The write is one transaction:

1. Lock the workshop order row (`SELECT … FOR UPDATE` on `workshop_orders` for that tenant), the same lock `WorkshopCatalogLineService` uses.
2. Re-read the task, its lines, reservations, warranty-claim links, and estimate versions.
3. If any row is `ERROR`, or a document blocker is present, return **409** `APPLY_BLOCKED` and write nothing. `rate_choice` clears `LABOR_RATE_CONFLICT` only. `price_choice` clears `CATALOG_PRICE_CONFLICT` only. No other blocker is cleared by a flag.
4. If `line_items_version` is not `expected_line_items_version`, return **409** with the existing conflict message from `incrementTaskLineItemsVersion`: `Workshop task line items changed; please reload and retry`.
5. If the latest estimate version is `SENT`, `APPROVED`, `DECLINED`, `EXPIRED`, or `SUPERSEDED` and `create_revision` is false, return **409** `APPROVED_OR_SENT_ESTIMATE_UNCHANGED`. Do not change that version's `snapshot`, `snapshot_sha256`, totals, or status. Do not change lines. Do not increment `line_items_version`.
6. If `create_revision` is true and the latest version is `DRAFT`, return **409** `ESTIMATE_DRAFT_OPEN` (the same rule as `createRevision`). Write nothing.
7. If `create_revision` is true and the order has no estimate, return **409** `ESTIMATE_MISSING`. Write nothing.
8. If a `CREATE` or price-changing row matches an existing line by provenance key and the proposed `quantity`, `unit_price`, or `standard_aw` differs, `accept_price_changes` must be true. Otherwise **409** `PRICE_CHANGE_UNCONFIRMED` and write nothing.
9. If that existing line has consumed quantity greater than 0, or a `WarrantyClaimLine`, the blocker is `CONSUMED_LINE_LOCKED` or `WARRANTY_LINE_LOCKED` and step 3 already rejected the apply. This slice does not shrink or cancel those lines.
10. When step 5 passes and `create_revision` is true, insert one `WorkshopEstimateVersion` with `version = latest + 1` and `status = DRAFT`. Do not copy the previous snapshot. Do not update the previous row. Do not send the draft.
11. Insert `CREATE` lines. Update a matched unconsumed line only when `accept_price_changes` is true. Leave every line whose `source_system` is not `AUDATEX_BMS` untouched. Do not `deleteMany` lines.
12. Call `incrementTaskLineItemsVersion` once for the task.
13. Upsert `ExternalIdMapping` with `external_id` set to the document key (`SYN-EST-1001|EM|0` for the happy fixture) and `entity_id` set to the workshop order id. Do not use `DocumentID` alone. Set the job `APPLIED` and `appliedAt`.

The approved version's `snapshot_sha256` after a successful revision apply is the same bytes it had before the transaction. The new version's `snapshot` is null until the existing send action freezes it.

A first apply of the happy fixture onto a task with `line_items_version` 0 and no estimate creates four lines and leaves `line_items_version` 1. `create_revision` is false. `accept_price_changes` is false.

---

## Database Impact

### New Tables / Columns

| Table | Column | Type | Nullable | Notes |
| --- | --- | --- | --- | --- |
| `workshop_task_line_items` | `import_provenance` | `JSONB` | Yes | Additive. Null on every existing line. Shape is the provenance object in the mapping table. No new index in this slice. |

### Modified Tables

| Table | Change | Migration Required? |
| --- | --- | --- |
| `ImportEntityType` | Add enum value `DAMAGE_ESTIMATE` | Yes, additive Prisma migration |
| `workshop_task_line_items` | Nullable `import_provenance` | Yes, additive |
| `import_jobs`, `import_job_rows`, `external_id_mappings` | Rows only. No new columns | No |

`ExternalIdMapping.entity_id` stores the workshop order id. The unique key remains `(tenant_id, entity_type, source_system, external_id)`.

### Deletion Policy Impact

No new entity. `docs/deletion-policy.md` is not changed.

`WorkshopTaskLineItem` keeps its current rule: no hard delete once a reservation, inventory transaction, or warranty line exists. This apply path does not delete lines.

`WorkshopEstimateVersion` keeps its current rule: no delete endpoint, and sent or later rows stay immutable.

`ImportJob` gains no delete endpoint. A damage-estimate job is not removed by a repeated upload.

### State machines

No new order status and no new estimate status. Estimate revision uses the existing `DRAFT` insert. Import jobs use the existing `DRY_RUN_DONE` → `APPLIED` transition. A rejected apply leaves the job at `DRY_RUN_DONE`. A thrown write sets `FAILED` only after the line transaction has rolled back, so a `FAILED` job has not left new lines behind.

### Inventory and finance

No `InventoryTransaction`. No invoice, credit note, or fiscal receipt. `FinanceSettings.lock_date` is not consulted because no fiscal document is posted. Part lines stay `PENDING_PICK` until the existing pick flow.

### Real-time sync

`WORKSHOP_TASK_LINE_ITEM` is already in `SUPPORTED_ENTITY_TYPES` and in `dashboard-entity-map.ts`. No new entity type. `ImportJob` does not emit dashboard events.

### Numbering

No new number sequence. A revision keeps the existing `WorkshopEstimate.estimate_number`.

---

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
| --- | --- | --- | --- | --- |
| POST | `/api/imports/damage-estimates` | multipart `file`, `workshopOrderId`, `taskId` | 201 job, or 200 existing job | JWT, `OWNER` / `ADMIN` / `SALES`, active site |

Existing `GET /api/imports/:id` and `GET /api/imports/:id/rows` return the new job. They stay tenant-scoped.

`POST /api/imports/:id/apply` already exists. This slice does not replace that route and does not remove `accept_all_price_jumps` or `accepted_row_numbers`.

### Modified Endpoints

| Method | Route | Change Description |
| --- | --- | --- |
| POST | `/api/imports` | Unchanged CSV dry-run. It rejects `entityType=DAMAGE_ESTIMATE` with the existing invalid-entity response. |
| GET | `/api/imports/templates/:entityType` | `DAMAGE_ESTIMATE` is **404**. No CSV template. |
| POST | `/api/imports/:id/apply` | Same route. `CUSTOMER`, `VEHICLE`, and `SUPPLIER_PRICE_LIST` still accept only `accept_all_price_jumps` and `accepted_row_numbers`. A body that also sends `expected_line_items_version`, `create_revision`, `accept_price_changes`, `rate_choice`, or `price_choice` returns **422** `APPLY_BODY_MISMATCH` and does not apply. `DAMAGE_ESTIMATE` accepts only the body in the apply section. A body that sends `accept_all_price_jumps` or `accepted_row_numbers` returns **422** `APPLY_BODY_MISMATCH` and does not apply. |
| POST | `/api/orders/:id/estimates/revisions` | Unchanged. Apply does not call this HTTP route. It performs the same insert inside its own transaction. |

Error body shape for every code in this spec:

```json
{ "code": "UNKNOWN_VERSION", "message": "The damage estimate version is not supported." }
```

`message` is the sentence in this table. Tests assert the code and the message.

| Code | HTTP | Message |
| --- | --- | --- |
| `UNKNOWN_VERSION` | 422 | The damage estimate version is not supported. |
| `CORRUPT_FILE` | 422 | The damage estimate file is not valid XML. |
| `UNSUPPORTED_DOCUMENT` | 422 | The damage estimate document type is not supported. |
| `FILE_TOO_LARGE` | 422 | The damage estimate file is larger than 10 MiB. |
| `APPLY_BODY_MISMATCH` | 422 | The apply body does not match this import type. |
| `VEHICLE_IDENTITY_INVALID` | 422 | The damage estimate VIN is missing or not 17 letters or digits. |
| `ORDER_NOT_FOUND` | 404 | The workshop order was not found. |
| `TASK_NOT_FOUND` | 404 | The workshop task was not found on this order. |
| `ORDER_SITE_MISMATCH` | 409 | The workshop order is not on the active site. |
| `ORDER_NOT_OPEN` | 409 | The workshop order is not open for an estimate import. |
| `VEHICLE_MISMATCH` | 409 on apply, listed on the 201 job | The damage estimate VIN does not match the order vehicle. |
| `UNKNOWN_UNIT` | 409 on apply, listed on the 201 job | The damage estimate uses a unit this import does not accept. |
| `OTHER_CHARGE_UNMAPPED` | 409 on apply, listed on the 201 job | An other-charge line has no confirmed price basis. |
| `UNKNOWN_PART_TYPE` | 409 on apply, listed on the 201 job | The damage estimate part type is not supported. |
| `UNKNOWN_LABOR_TYPE` | 409 on apply, listed on the 201 job | The damage estimate labour type is not supported. |
| `UNMAPPABLE_ELEMENT` | 409 on apply, listed on the 201 job | The damage estimate line contains an element this import does not map. |
| `DUPLICATE_ELEMENT` | 409 on apply, listed on the 201 job | The damage estimate line repeats a part or labour element. |
| `LINE_IDENTITY_MISSING` | 409 on apply, listed on the 201 job | The damage estimate line has no sequence number. |
| `LINE_DESC_MISSING` | 409 on apply, listed on the 201 job | The damage estimate line has no description. |
| `TAXABLE_FLAG_MISSING` | 409 on apply, listed on the 201 job | The damage estimate line has no taxable flag. |
| `PRICE_UNIT_CONFLICT` | 409 on apply, listed on the 201 job | The damage estimate price and quantity do not agree. |
| `INCLUDED_LINE_CONFLICT` | 409 on apply, listed on the 201 job | An included labour line still has hours or an amount. |
| `BETTERMENT_REVIEW` | 409 on apply, listed on the 201 job | Betterment is not imported as a workshop line. |
| `AW_PRECISION` | 409 on apply, listed on the 201 job | The labour hours do not fit the Arbeitswert precision. |
| `INVALID_AW_MINUTES` | 409 on apply, listed on the 201 job | The tenant Arbeitswert length is not usable. |
| `LABOR_CATEGORY_MISSING` | 409 on apply, listed on the 201 job | A labour category with a selling rate is required. |
| `LABOR_RATE_CONFLICT` | 409 on apply, listed on the 201 job | The estimate labour rate differs from the labour category rate. |
| `CATALOG_PRICE_CONFLICT` | 409 on apply, listed on the 201 job | The estimate part price differs from the catalog price. |
| `CONSUMED_LINE_LOCKED` | 409 on apply, listed on the 201 job | A consumed workshop line cannot be changed by this import. |
| `WARRANTY_LINE_LOCKED` | 409 on apply, listed on the 201 job | A workshop line on a warranty claim cannot be changed by this import. |
| `APPLY_BLOCKED` | 409 | The damage estimate import has review blockers. |
| `DOCUMENT_VERSION_CONFLICT` | 409 | This estimate version was already uploaded with different contents. |
| `APPROVED_OR_SENT_ESTIMATE_UNCHANGED` | 409 | The sent or approved estimate version was left unchanged. |
| `ESTIMATE_DRAFT_OPEN` | 409 | The current draft must be sent before a revision can be created. |
| `ESTIMATE_MISSING` | 409 | The workshop order has no estimate to revise. |
| `PRICE_CHANGE_UNCONFIRMED` | 409 | Confirm the price change before applying the damage estimate. |
| `ESTIMATE_ROLE_FORBIDDEN` | 403 | Kostenvoranschlag actions require the owner, admin or sales role. |

Line and document blockers are returned on the dry-run job as well as inside `APPLY_BLOCKED`. The HTTP status of the upload stays 201 for those cases. `APPLY_BLOCKED.details.blockers` is the array of those codes. The 409 body for a single confirmation failure (`APPROVED_OR_SENT_ESTIMATE_UNCHANGED`, `PRICE_CHANGE_UNCONFIRMED`, and the other confirmation codes) has no `details` array.

`ESTIMATE_DRAFT_OPEN` uses the message already thrown by `WorkshopEstimateService.createRevision`. `ESTIMATE_ROLE_FORBIDDEN` uses the message already thrown by `assertEstimateRole`. The compare-and-swap failure is not a new code: HTTP 409, message `Workshop task line items changed; please reload and retry`.

### OpenAPI Regeneration

The implementation issue runs both commands and commits both artifacts. This spec changes no generated file.

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

The screen is the existing workshop order, not a new list route. The review is a section under the order lines.

### Layout & Actions

- [x] Page-level actions sit top-right: `Review estimate`, and inside the review, `Apply lines` and `Create revision`.
- [x] Top-left stays the order title, breadcrumbs, and badges.
- [x] The order header keeps `text-2xl font-semibold tracking-tight`.
- [x] The review subtitle uses `text-slate-500` and names the document id and BMS version.

### List Pages (if applicable)

- [x] Not a create-entity list. No `+` button for this import.
- [x] The review table searches description, item number, and blocker code.
- [x] Columns use `DataTable` / `DataTableColumnHeader`: line, kind, description, quantity, AW, unit price, line net, status.
- [x] Status uses `StatusBadge`. The implementation adds four keys to `statusClassMap`: `import-ready`, `import-blocked`, `import-included`, `import-skipped`.
- [x] Row click expands the provenance paths. It does not navigate away.
- [x] No row delete. Right-click delete is omitted because a blocked row is not an entity delete.

### Form Handling

- [x] Apply is an explicit button. Debounced auto-save is the wrong control: writing lines bumps `line_items_version` and may open a revision. The review does not auto-save.

### Real-Time Sync

- [x] No new `SUPPORTED_ENTITY_TYPES` entry.
- [x] No new `dashboard-entity-map.ts` entry. Applied lines already emit `WORKSHOP_TASK_LINE_ITEM`.

---

## Component Design

| Component | Location | Purpose |
| --- | --- | --- |
| `DamageEstimateImportReview` | `apps/core-web/src/features/workshop/` next to the order lines | Upload, show the dry-run rows, and post apply with the captured `line_items_version`. |
| `useDamageEstimateImport` | `apps/core-web/src/api/` using the workshop query-key factory | Upload and apply mutations. Invalidates the order and the estimate queries. |

No new page in `App.tsx`.

---

## Testing Plan

### Backend

The one implementation issue adds these tests. Fixtures are the XML in this spec and the one-edit variants. No customer file, no insurer file, and no network. The boxes stay open until that issue lands the tests.

- [ ] Parser unit test: the happy fixture yields the four lines, the skip row, quantities, AW, unit prices, and nets in the table above, with `aw_minutes` 6.
- [ ] Parser unit test: `BMSVer` `5.4.0` and a missing `DocumentInfo` each return `UNKNOWN_VERSION` and do not create a job.
- [ ] Parser unit test: a truncated root returns `CORRUPT_FILE`.
- [ ] Parser unit test: `UnitOfMeasure` `AW` returns `UNKNOWN_UNIT` and `OTHER_CHARGE_UNMAPPED`.
- [ ] Service test: VIN `SYNTH0DAMAGE00002` against order VIN `SYNTH0DAMAGE00001` returns `VEHICLE_MISMATCH`, and apply writes zero lines.
- [ ] Service test: latest version `APPROVED` with a known `snapshot_sha256`. Apply without `create_revision` returns `APPROVED_OR_SENT_ESTIMATE_UNCHANGED`, and the hash and `line_items_version` are unchanged. Apply with `create_revision: true` inserts one `DRAFT`, leaves the approved hash unchanged, and increments `line_items_version` by 1.
- [ ] Service test: a second upload of the same bytes returns the same job id and does not increment `line_items_version`.
- [ ] Service test: `expected_line_items_version` mismatch returns the existing 409 conflict and writes nothing. Start from `agent-proposal.service.approve-lines.spec.ts`, which already covers that compare-and-swap.
- [ ] HTTP dry-run shape follows `test/catalog-external.e2e-spec.ts` only as the existing import test style. That file does not assert this feature.
- [ ] Service test: `POST /api/imports/:id/apply` on a `SUPPLIER_PRICE_LIST` job still accepts `accept_all_price_jumps: true` and does not require `expected_line_items_version`. The same fields on a `DAMAGE_ESTIMATE` job return `APPLY_BODY_MISMATCH`.

### Frontend

- [ ] After the implementation issue, the advisor flow is checked in the browser: upload the happy fixture, see four ready rows and one included row, apply, see `line_items_version` move, and see an approved version remain on screen with the same total while a new draft appears only after `Create revision`.

---

## Bounded implementation issue

One issue, after this spec is accepted. It does not build DAT and it does not call a provider.

**Title:** Import one Audatex BMS 5.7.0 estimate into reviewable workshop lines

**In scope**

- XML parse of the paths in this spec, plus the dry-run and apply routes.
- Additive migration: `ImportEntityType.DAMAGE_ESTIMATE`, `WorkshopTaskLineItem.import_provenance`.
- OpenAPI and frontend type regeneration.
- One review section on the workshop order.
- The backend tests listed above.
- One XML parser dependency that rejects `DOCTYPE` and does not use the network. No Audatex or DAT SDK.

**Out of scope**

- DAT, CIECA schema download, live GetDocument, insurer submission, sending the Kostenvoranschlag, stock reservations, and any agent tool.

**Done when**

- The happy fixture's four lines match the table, including AW at `aw_minutes` 6.
- Unknown version, corrupt XML, unknown unit, and a non-matching VIN fail as specified.
- An approved version's `snapshot_sha256` is unchanged across both the refused apply and the revision apply.
- CI is green without weakening an assertion.

---

## Open Questions

None for this slice. DAT waits on the Schnittstellen-Kompendium. Tax-total elements wait on the CIECA 5.7.0 schema bytes or the Audatex data-mapping appendix. Neither gap is filled by a guessed element name.

---

## References

- [ADR-0029](../../01-ADR/2026-10-15-audatex-bms-damage-estimate-import.md)
- [ADR-0025](../../01-ADR/2026-10-02-customer-communication-and-approvals.md)
- [ADR-0022](../../01-ADR/2026-08-31-site-operational-scope.md)
- [ADR-0011](../../01-ADR/2026-04-12-atomic-status-transition-guards.md)
- [ADR-0002](../../01-ADR/2026-04-12-ledger-based-inventory.md)
- Entry points: `apps/core-api/src/import/import.controller.ts`, `apps/core-api/src/import/import.templates.ts`, `apps/core-api/src/workshop/workshop-catalog-line.service.ts`, `apps/core-api/src/workshop/workshop-task-line-items.helpers.ts`, `apps/core-api/src/workshop/workshop-estimate.service.ts`
- Tests to start from: `apps/core-api/test/catalog-external.e2e-spec.ts`, `apps/core-api/src/agent-proposal/agent-proposal.service.approve-lines.spec.ts`
- [AUT-528](https://linear.app/auto-core-platform/issue/AUT-528/spec-first-eine-audatex-dat-unfallkalkulation-in-prufbare)

---

## Linear Tracking

| Field | Value |
| --- | --- |
| Project | https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b |
| Milestone | M5 Snap & Done and vehicle enrichment |
| Issues | AUT-528. The bounded implementation issue is described above and is not created by this spec. |
