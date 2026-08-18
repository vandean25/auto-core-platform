# Deferred Architectural Decisions

This log tracks **product and architecture debt we might actually build**. It is not a copy of the pragmatic-architecture framework documentation backlog.

Framework-meta items from 2025 (Phase 2B / 3B / 4B examples, README documentation tasks) were archived on 2026-08-18. They had no owner and were never reviewed monthly. See [`framework-archive-deferrals.md`](framework-archive-deferrals.md).

## Status Key

- **Deferred**: Decision to defer is active, watching for trigger
- **Triggered**: Trigger condition met, needs implementation
- **Implemented**: Feature has been implemented (moved to ADR)
- **Cancelled**: No longer needed or relevant

---

## Deferred Decisions

Three active items, all from ADR-0016. Phase A (used buy → VIN stock → workshop prep → sell with margin VAT) is the only vehicle-stock work in scope until a trigger below is met. Schema already reserves enums and FKs for B/C/D; unused hooks are **not** a reason to start those flows.

### Vehicle trade-in (phase B)

**Status**: Deferred
**Deferred Date**: 2026-08-15
**Category**: Architecture
**Priority**: Medium

**What Was Deferred**:
Taking a customer's car as (part) payment on a vehicle sale and putting that VIN into used stock (`acquisition_kind = TRADE_IN`, `VehicleSale.trade_in_purchase_id`).

**Original Proposal**:
Incadea Sales Trade-In (table 5025442) linked to the vehicle sale, creating a used-vehicle purchase.

**Rationale for Deferring**:
- Current need score: 6/10 (explicit next phase after A)
- Complexity score: 6/10 (valuation, net-to-pay invoice, VIN reuse of buyer's car)
- Cost of waiting: Low if A leaves the FK and enum in schema
- Phase A VIN reuse on purchase already covers the hard identity problem

**Simpler Current Approach**:
Buy used cars via `VehiclePurchase` `DIRECT` only. Schema includes unused `TRADE_IN` and nullable `trade_in_purchase_id`.

**Trigger Conditions** (Implement when):
- [ ] Phase A used buy-stock-sell is live for a real tenant (not just schema/enums)
- [ ] That tenant needs to net a trade-in against a stock sale on **one invoice**

Do not start B because Incadea had the table, or because the unused FK exists.

**Implementation Notes**:
See ADR-0016 appendix and `vehicle-stock-trading.md` appendix B. Receive flips the buyer's existing VIN to `USED`. Invoice nets sale minus allowance.

**Related Documents**:
- `docs/internal/01-ADR/2026-08-15-vehicle-stock-not-parts-inventory.md`
- `docs/internal/02-Feature-Specs/Vehicle/vehicle-stock-trading.md`

**Last Reviewed**: 2026-08-18

### New vehicles from vendor (phase C)

**Status**: Deferred
**Deferred Date**: 2026-08-15
**Category**: Architecture
**Priority**: Medium

**What Was Deferred**:
New-car purchase orders from importer/vendor, `inventory_role = NEW`, standard VAT on sale, `ON_ORDER` before receive. OEM allocate/hold/factory options stay even later.

**Original Proposal**:
Incadea Vehicle Purchase with Vehicle Status New and standard posting groups.

**Rationale for Deferring**:
- Current need score: 5/10
- Complexity score: 7/10 if OEM pipeline is included; 4/10 for basic vendor PO
- Cost of waiting: Low — `NEW` and `STANDARD` tax_mode already on enums

**Simpler Current Approach**:
Used cars only (`USED` + `MARGIN`). v1 APIs must not write `NEW` or `STANDARD`.

**Trigger Conditions** (Implement when):
- [ ] Phase A is live for a real tenant
- [ ] A tenant sells **new** vehicles from a vendor/importer (not OEM factory hold)

Do not start C because the `NEW` enum exists. Do not include OEM allocate/hold in the first C slice.

**Implementation Notes**:
Reuse `VehiclePurchase` / `VehicleSale` / `Invoice.tax_mode = STANDARD`. Purchase writes `inventory_role = NEW`, `tax_scheme = STANDARD`. `ON_ORDER` when ordered but not received.

**Related Documents**:
- `docs/internal/01-ADR/2026-08-15-vehicle-stock-not-parts-inventory.md`

**Last Reviewed**: 2026-08-18

### Demo / company cars (phase D)

**Status**: Deferred
**Deferred Date**: 2026-08-15
**Category**: Architecture
**Priority**: Low

**What Was Deferred**:
Demo and company cars (`inventory_role = DEMO`): own use then sell, typically standard VAT.

**Original Proposal**:
Incadea Demo Vehicle status + demo posting group + Own Sale.

**Rationale for Deferring**:
- Current need score: 4/10
- Complexity score: 5/10 (own-use, tax on sale of former demo)
- Cost of waiting: Low — enum value reserved

**Simpler Current Approach**:
`STOCK_PREP` on `USED` stock covers prep; no demo role written in A.

**Trigger Conditions** (Implement when):
- [ ] Phase A is live; preferably C as well if demos start as new stock
- [ ] A tenant keeps cars for **own use** before retail sale
- [ ] Accountant has confirmed VAT treatment on demo disposal

Do not start D because `DEMO` is on the enum.

**Implementation Notes**:
Accountant must confirm VAT on demo disposal. Workshop can keep using `STOCK_PREP` (or a later `OWN_USE` purpose). Sale typically `STANDARD` VAT.

**Related Documents**:
- `docs/internal/01-ADR/2026-08-15-vehicle-stock-not-parts-inventory.md`

**Last Reviewed**: 2026-08-18

---

## Review Process

There is **no** monthly or quarterly ritual on this file — that review was not happening.

Re-read this log when:

- Opening or amending a vehicle-stock ADR or feature spec
- A tenant asks for trade-in, new-car PO, or demo/company cars
- A trigger checkbox above is actually true

Then update status, or cancel the phase if the product dropped it.

**When a trigger is met**:

1. Set status to **Triggered**
2. Create or update an ADR for that phase (do not silently grow ADR-0016's Phase A scope)
3. Plan implementation in the next milestone
4. After ship, set status to **Implemented**

---

## Metrics

Reset 2026-08-18. Counts below are **product deferrals only**. Twenty-two framework-meta items were archived that day and are not in these numbers.

| Metric | Value | Notes |
|--------|-------|-------|
| Total deferrals | 3 | Vehicle stock B / C / D |
| Active deferrals | 3 | Currently deferred |
| Triggered awaiting implementation | 0 | Need to address |
| Implemented | 0 | Were eventually needed |
| Cancelled | 0 | Were never needed |
| Average time before trigger | — | None triggered yet |
| Hit rate (implemented/total) | n/a | Reset; nothing from this log has shipped |

**Target**: < 40% hit rate (most deferred things remain unneeded, validating deferral decisions)

---

## Template for New Deferrals

Add only product or architecture debt we might actually build. Use the format in `.architecture/templates/deferrals.md`. Do not copy framework documentation tasks into this file.
