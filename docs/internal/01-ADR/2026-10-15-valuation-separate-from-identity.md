---
title: "ADR-0028: Vehicle valuation is a separate port from identity"
date: "2026-10-15"
status: proposed
deciders: "Product Owner, Architecture Team"
linear-project: "https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b"
linear-milestone: "M5 Snap & Done and vehicle enrichment"
tags:
  - adr
  - vehicle
  - valuation
---

# ADR-0028: Vehicle valuation is a separate port from identity

## Status

**Proposed** — 2026-10-15

## Context

ADR-0021 defines `VehicleIdentityProvider` as plate/VIN to a canonical key bag. The sandbox implementation writes `identity_keys.vin` only. `Vehicle` already stores `vin`, `hsn`, `tsn`, `typenschein_no`, and `national_code` as separate columns. AUT-516 stores the Austrian Zulassungsschein Nationalcode on `national_code` and explicitly leaves Eurotax and Schwacke to AUT-527.

Public Autovista material lists identification and valuation as different products (Identification web service / AutovistaID API versus Valuation web service / AutovistaVALUATION, and a separate Forecast service). The Austrian nationaler Typencode is a 6-digit type/version/variant code assigned by Eurotax for the ministry. It is not a VIN and not a type-approval number. Published API licences limit calls to individual vehicles, forbid bulk queries, and say API results should not be stored for future use.

A valuation that wrote `VehiclePurchase.purchase_price`, `VehicleSale.sale_price`, or `kaufvertrag_snapshot` would turn a market observation into a commercial price without a person deciding that price.

## Decision

1. Identity and valuation are different ports. `VehicleValuationProvider` does not implement `VehicleIdentityProvider` and does not write `identity_keys`, `national_code`, `vin`, `hsn`, `tsn`, or `typenschein_no`.
2. The first slice is Eurotax Austria AutovistaVALUATION, market `AT`, valuation type `MARKET_VALUE`, currency `EUR`, keyed by the stored 6-digit `national_code`. Schwacke, residual forecast, and VIN valuation are not adapters in this decision.
3. A quote is an append-only `VehicleValuationSnapshot` for the decision the person saw: amount, currency, source, provider as-of date, reference version, and hashes. The raw provider body is not stored. The snapshot never writes a purchase price, a sale price, a Kaufvertrag snapshot, an invoice line, or a vehicle-ledger entry.
4. The production binding is a disabled provider until a tenant order grants the product and explicitly permits retaining that decision record. No order, contact, or data purchase is implied by this ADR.
5. `native_id` stays null with state `NATIVE_ID_UNKNOWN`. Public sources reviewed for AUT-527 do not define NativeID, so it is not an alias of the national code, the VIN, or the Typenschein.

## Consequences

### Positive

- A type code cannot be substituted for a chassis id.
- Sale and purchase documents keep the price a person saved.
- The licence limit on storing API results is visible in the port: no reusable catalog, no raw body.

### Negative

- A second port and a snapshot table are required before any quote can be shown.
- The disabled provider returns no amount until a real order exists. That order is not part of this ADR.

### Neutral

- ADR-0021 catalog, labor, and JIT behavior is unchanged.
- `SandboxVehicleIdentityProvider` stays a VIN sandbox.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Put the Eurotax code in `identity_keys` and price the vehicle inside the identity resolver | One call | Collapses two licensed products and can overwrite identity on a price lookup |
| Treat `national_code` as another spelling of VIN or Typenschein | No new column | Contradicts the ministry definition and AUT-516 |
| Write the quote onto `sale_price` or `purchase_price` | One less table | A market observation becomes the contract price |
| Store the raw provider payload as a cache | Faster repeat quotes | Published licence text says API results should not be stored for future use |
| Call Schwacke and Eurotax together | Covers DE and AT | Two brands, two licences, and no Schwacke code column |

## Pragmatic Enforcer Analysis

Pragmatic mode is enabled for ADR creation.

- Necessity: 8/10. AUT-527 needs the split now. Waiting lets an implementation alias the national code to the VIN.
- Complexity: 4/10. One port, one market, one valuation type, one snapshot table, disabled in production.
- Ratio: 0.5 (target under 1.5).
- Simpler path rejected: a JSON note on `Vehicle` with no port. It would still be a price write without provenance, and it would not keep the raw body out.
- Recommendation: approve this scope. Do not add forecast, Schwacke, or automatic pricing.

## References

- [vehicle-nationalcode-valuation.md](../02-Feature-Specs/Vehicles/vehicle-nationalcode-valuation.md)
- [ADR-0021](2026-08-28-vehicle-intelligence-catalog-providers.md)
- [registration-document-intake.md](../02-Feature-Specs/Vehicles/registration-document-intake.md)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b |
| Milestone | M5 Snap & Done and vehicle enrichment |
| Issues | AUT-527, AUT-551 |
