---
title: "ADR-0029: Audatex BMS 5.7.0 file is the first damage-estimate import"
date: "2026-10-15"
status: proposed
deciders: "Product Owner, Architecture Team"
linear-project: "https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b"
linear-milestone: "M5 Snap & Done and vehicle enrichment"
tags:
  - adr
  - workshop
  - import
  - estimate
---

# ADR-0029: Audatex BMS 5.7.0 file is the first damage-estimate import

## Status

**Proposed** — 2026-10-15

## Context

Workshops already import customers, vehicles, and supplier price lists as CSV through `ImportJob`. They already turn workshop task lines into a versioned Kostenvoranschlag (`WorkshopEstimate` / `WorkshopEstimateVersion`) whose sent and approved snapshots stay immutable (ADR-0025). There is no import of an accident damage estimate.

Audatex and DAT both calculate those estimates. Their current full interface packs are not public: the DAT Schnittstellen-Kompendium sits behind the myDAT customer login (DAT newsletter 051, 31 July 2015), and the CIECA BMS 5.7 schema files are member downloads. A parser that invents either vendor's unpublished XML would be a guess.

What is public is enough for one file format. Audatex's Estimate Document Return guide states that the estimate return message is CIECA BMS version 5.7.0. A public BMS fragment shows `VehicleDamageEstimateAddRq` line elements for parts, labour hours, refinish labour, and other charges. CCC's published BMS field list names the document version, the VIN, and part price adjustments. That is one documented document, not two providers and not a live API.

## Decision

1. The first damage-estimate import reads one uploaded **Audatex Estimate Return** XML document: CIECA BMS **5.7.0**, root `VehicleDamageEstimateAddRq`, namespace `http://www.cieca.com/BMS`. DAT, live Audatex calls, insurer submission, and licence procurement stay out of this decision.
2. The file is not a CSV template and does not join `CUSTOMER`, `VEHICLE`, or `SUPPLIER_PRICE_LIST`. It is a new `ImportEntityType` value, `DAMAGE_ESTIMATE`, stored on the existing `ImportJob` / `ImportJobRow` / `ExternalIdMapping` tables. No new import table.
3. Apply writes `WorkshopTaskLineItem` rows through the existing line-version compare-and-swap (`line_items_version`). It never updates a `WorkshopEstimateVersion` that has left `DRAFT`. A revision is the existing new `DRAFT` version under the same estimate number. Apply does not send mail, does not call an insurer, and does not post stock or invoices.
4. Each applied line keeps an additive nullable `import_provenance` JSON document. `source_system` is `AUDATEX_BMS`. The approved estimate snapshot remains the price the customer accepted.
5. The import is an advisor HTTP action for `OWNER`, `ADMIN`, and `SALES` on the order's site. It is not an agent tool. `HUMAN_ONLY` actions stay excluded.

The field mapping, fixtures, and rejection rules are the feature spec `docs/internal/02-Feature-Specs/Workshop/damage-estimate-import.md`.

## Consequences

### Positive

- Parser tests use a synthetic file whose element names come from public BMS material.
- An approved Kostenvoranschlag cannot change because a file was uploaded again.
- One implementation issue can land the parser and the review apply path. DAT is a later spec, after its compendium is actually in hand.

### Negative

- BMS fields that are absent from the public fragment are unmappable on purpose. Paint and other-charge lines block review instead of receiving a guessed price basis.
- Tax totals are not read from the file. The later Kostenvoranschlag snapshot still applies the tenant tax rules at send.
- `ImportEntityType` gains a value that the CSV template endpoint must reject.

### Neutral

- `WorkshopTaskLineItem` stays `LABOR` or `PART`. Provenance records which BMS element produced the row.
- Realtime already emits `WORKSHOP_TASK_LINE_ITEM`. This decision adds no dashboard entity.

## Alternatives Considered

| Option | Pros | Cons |
| --- | --- | --- |
| DAT VXS / `getCalculationResults` as the first slice | Closer to AT/DE workshop practice and Arbeitswerte | The current calculation schema is the login-gated Schnittstellen-Kompendium. The 2015 newsletter's Italy field list is a regional rename, not a DACH example file. |
| Live Audatex GetDocument API | Matches the production return flow | Needs a licence, credentials, and a network call. Out of scope for this slice. |
| A new damage-estimate table and a handwritten vendor parser | Room for every future provider | Invents a store and a grammar the public sources do not give us. |

## References

- Feature spec: [damage-estimate-import](../02-Feature-Specs/Workshop/damage-estimate-import.md)
- [ADR-0025](2026-10-02-customer-communication-and-approvals.md) — estimate versions and immutable snapshots
- [ADR-0022](2026-08-31-site-operational-scope.md) — site comes from the authenticated membership
- [ADR-0011](2026-04-12-atomic-status-transition-guards.md) — `line_items_version` compare-and-swap
- [ADR-0002](2026-04-12-ledger-based-inventory.md) — this import does not write `InventoryTransaction`
- Audatex / Solera, Estimate Document Return API Integration Guide (message version 5.7.0): https://na.api.solera.com/files/Estimate%20Return%20API.pdf
- CIECA Estimate Service schema file names: https://www.cieca.com/Services/estimate-service
- Public BMS line fragment (12 August 2021): https://stackoverflow.com/questions/68761455/lateral-flatten-outer-on-xml-file-does-not-work
- CCC Secure Share BMS field list: https://www.cccsecureshare.com/legal/limitedpartsmessages
- DAT newsletter 051 (31 July 2015), compendium behind customer login: https://www.dat.de/fileadmin/media/download/Newsletter/Newsletter_interfaces_051_082015.pdf

---

## Linear Tracking

| Field | Value |
| --- | --- |
| Project | https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b |
| Milestone | M5 Snap & Done and vehicle enrichment |
| Issues | AUT-528 |
