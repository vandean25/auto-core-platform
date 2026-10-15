---
title: "National-code identity and Eurotax valuation"
date: "2026-10-15"
module: "Vehicle"
status: draft
linear-project: "Vehicle Intelligence & Parts Catalog"
linear-milestone: "M5 Snap & Done and vehicle enrichment"
tags:
  - feature-spec
  - vehicle
  - valuation
---

# National-code identity and Eurotax valuation

## Summary

A salesperson can request one current market value for a vehicle whose Austrian national code is already stored, see the source and the as-of date, and keep that quote as evidence. The quote is not a VIN decode and it is not a sale price. Identity stays on `Vehicle`. Valuation is a separate disabled port until a real Eurotax Austria order exists. Checked against commit `6504f59b`. Synthetic fixtures are in [vehicle-nationalcode-valuation.fixtures.json](./vehicle-nationalcode-valuation.fixtures.json). The only customer label in those fixtures is `pilot customer`.

This document is the AUT-527 deliverable. It does not call Eurotax or Schwacke, and it does not buy data.

---

## User Stories

- As a **salesperson** (`SALES`), I want a market value for a stock or customer vehicle that already has a 6-digit Austrian national code, with the source and the date, so that I can judge an asking price without the software changing the contract.
- As an **owner or admin**, I want an uncertain code, two variants, a missing mileage, or a stale quote to stay visible and unresolved, so that nobody treats a guess as the vehicle.
- As a **tenant admin**, I want valuation kept out of the product until a named usage right allows that one quote to be retained, so that a sandbox identity decode is never described as provider access.

---

## Verified current behavior

| Fact | Where it lives |
|---|---|
| `VehicleIdentityProvider` accepts `vin` and `plate` and returns make, model, and optional `hsn`, `tsn`, and `identity_keys`. | `vehicle-identity.provider.ts` |
| `SandboxVehicleIdentityProvider` is the bound implementation. A VIN that starts with `FAIL` rejects. Any other VIN returns a sandbox make and `identity_keys: { vin }`. It does not read or write `national_code`. | `vehicle-identity.provider.ts`, `vehicle.module.ts` |
| `POST /api/vehicles/:id/resolve-identity` resolves from the stored VIN and plate. Tests in `vehicle-identity.service.spec.ts` cover that sandbox. They are not evidence of a national-code or valuation provider. | `vehicle.controller.ts`, `vehicle-identity.service.ts` |
| `Vehicle` stores `vin`, `hsn`, `tsn`, `typenschein_no`, and `national_code` (`VarChar(16)`) as separate fields. `national_code` is indexed with `tenant_id`. | `schema.prisma` |
| AUT-516 writes `national_code` only from a confirmed Zulassungsschein field. It rejects a value equal to the VIN or 17 characters long. It does not copy the code into `identity_keys`, `typenschein_no`, `hsn`, or `tsn`. | `registration-document-intake.md` |
| `VehiclePurchase.purchase_price` and `VehicleSale.sale_price` are required decimals on those documents. `VehicleSale.kaufvertrag_snapshot` is the contract snapshot. None of these columns is written by identity resolution. | `schema.prisma` |
| Vehicle routes use the global JWT guard. A `TECH` session cannot call a back-office route unless it is marked mechanic-accessible. The public API key surface is read-only. | `JwtAuthGuard`, ADR-0026 |
| There is no valuation table, no valuation route, and no Eurotax or Schwacke client in `apps/core-api`. | Repository search at `6504f59b` |

---

## Decisions

ADR-0028 records the lasting split: valuation is a new port, and a quote is not a price. ADR-0021 is unchanged for parts and labor.

1. The first slice is **Eurotax Austria, product AutovistaVALUATION, market `AT`, valuation type `MARKET_VALUE`, currency `EUR`**. Schwacke is the German brand of the same group and is not called. AutovistaFORECAST is not called.
2. The lookup key is the stored Austrian nationaler Typencode when it is exactly six digits. The request does not send the VIN, the plate, the Typenschein, or HSN/TSN.
3. Production binds `VEHICLE_VALUATION_PROVIDER` to a disabled provider. `isAvailable()` is false and `quote` performs no I/O. Tests bind a fake provider that returns rows from the fixture file.
4. A successful quote inserts one `VehicleValuationSnapshot`. It does not update the vehicle, the purchase, the sale, or the Kaufvertrag. A person who wants a different contract price edits that document in its existing form. This feature has no "apply value to price" action.
5. `native_id` is always null and `nativeIdState` is `NATIVE_ID_UNKNOWN`. No public source below defines NativeID.
6. Agents do not get a tool or an `AgentProposal` action for this feature. A price change stays on the human purchase and sale forms.

---

## Scope

In scope: the key table, the normalized quote contract, the five result families named in AUT-527, the snapshot purpose, the deletion rule, and the disabled provider.

Out of scope:

- Automated price setting, residual-value forecasts, and fleet or bulk queries.
- Reverse engineering a WSDL or scraping a licensed catalog. The wire body Eurotax expects is unpublished in this repository, so this spec does not invent SOAP or REST field names for their side.
- Schwacke, Glass's, Swiss 9-digit Natcode lookup, and VIN valuation.
- Changing `SandboxVehicleIdentityProvider` or the AUT-516 intake rules.
- Contacting Autovista, Schwacke, or Eurotax, or claiming a licence, a trial, or credentials.

---

## Two data products

| Product | Public name | What it identifies | What this system stores |
|---|---|---|---|
| Identity | Autovista identification / AutovistaID API, and the existing ACP identity port | A vehicle or a type key, depending on the method the caller chose | Existing `Vehicle` columns and `identity_keys` from the VIN sandbox |
| Valuation | AutovistaVALUATION | A market value for one already identified type, adjusted with mileage | A new snapshot row, only after a quote is actually retained under the licence rule below |

Autovista's own API overview lists the Identification web service and the Valuation web service as separate services, with Forecast as a third. Eurotax Austria sells AutovistaVALUATION as real-time used-car values and AutovistaFORECAST as residual values for 16 age and mileage combinations. Those are not one response.

The DMS transition page says the Austrian application becomes Eurotax (formerly Autowert) and the German application becomes Schwacke (formerly SchwackeNet), on a new REST interface with a method for vehicle valuations. That page is a vendor migration notice. It is not an ACP integration and it does not grant access.

---

## Key equivalences

Every row is evidenced. A blank "equals national code" cell means the key is not the national code.

| Key | Public meaning | Equals `Vehicle.national_code`? | Evidence |
|---|---|---|---|
| Austrian nationaler Typencode | A 6-digit running number Eurotax assigns, for the ministry, per factory brand, trade name, and type/version/variant. About 90 percent of manufacturers send it into the approval database, and it can be printed on the Zulassungsschein. Statistik Austria uses it. | Yes, only when the stored value matches `^[0-9]{6}$`. AUT-516 may have stored a wider token; this slice then refuses it instead of coercing it. | [BMIMI, Nationaler Code](https://www.bmimi.gv.at/themen/verkehr/strasse/fahrzeuge/fahrzeugtechnik/natcode.html) |
| VIN | One vehicle's chassis number. Autovista sells a separate VIN API. The licence lets the vendor process a VIN only to identify a vehicle and to record that lookup for billing, audit, and manufacturer reporting. | No. A 17-character value, or a value equal to the normalized VIN, is `UNCERTAIN_IDENTITY`. AUT-516 already refuses to save that shape as `national_code`. | [Autovista VIN API](https://autovista.com/product/vin-api/); Schwacke licence clause 11.4 on [schwacke.de AGB](https://schwacke.de/allgemeine-geschaeftsbedingungen/) |
| Swiss / Eurotax Natcode | A 9-digit number for a vehicle model, and one identification method in a list that also contains VIN and Typengenehmigung. | No. Nine digits are not the Austrian 6-digit code and are not sent to the AT valuation slice. | [Eurotax CH quickstart, Identifikation](https://eurotax.ch/wp-content/uploads/sites/7/2026/02/JDP-QS-Eurotax-SSM-CH-Identifikation.pdf) |
| Typenschein / Typengenehmigung | The type-approval certificate number. Eurotax CH lists Typengenehmigung separately from Natcode and from VIN. ACP stores it on `typenschein_no`. | No. If the normalized national code equals the normalized Typenschein, the result is `UNCERTAIN_IDENTITY` and the columns stay as they are. | Same Eurotax CH quickstart; `schema.prisma` |
| HSN and TSN | German manufacturer and type key numbers already stored on `Vehicle`. | No. This slice does not concatenate them and does not read them. | `schema.prisma`; ADR-0021 indexed columns |
| NativeID | Not defined by any public page reviewed on 2026-10-15. | No. The field stays null with `NATIVE_ID_UNKNOWN`. It is not filled from the national code, the VIN, or the Typenschein. | Absence in the sources listed under References. This is a known unknown, not a mapping. |
| `identity_keys.vin` | The sandbox copies the normalized VIN and nothing else. | No. Valuation does not write `identity_keys`. | `SandboxVehicleIdentityProvider` |

Eurotax Austria also says more than 97 percent of vehicles can be identified from the code in the registration, and that identification produces a NatCode used to read market values. That sentence ties a registration code to a valuation key. It does not say the code is the VIN or the Typenschein. The Austrian code's length and issuer are the BMIMI page, not the marketing sentence.

---

## First slice

| Input | Rule |
|---|---|
| Market | `AT` only. Any other market is `422` `VALUATION_MARKET_UNSUPPORTED` and does not call a provider. |
| Valuation type | `MARKET_VALUE` only. `RESIDUAL_FORECAST` is `422` `VALUATION_TYPE_UNSUPPORTED`. |
| National code | Stored `Vehicle.national_code`, echoed in the body. The body must equal the stored normalized code. The caller cannot supply a different code to fish the catalog. |
| As-of | `requestedAsOf` is `YYYY-MM-DD`, not after today in `Europe/Vienna`, and not before `first_registration_date`. Omitted means today in `Europe/Vienna`. |
| Currency | Requested `EUR`. A provider amount in another currency is `CURRENCY_CONFLICT`, amount null, and nothing is stored. |
| Mileage | Integer kilometres from 0 through 999999, supplied on this request. `Vehicle.mileage` is not a silent default. Eurotax states that vehicles missing mileage are left out of the calculation. |
| Condition | `ROADWORTHY_AVERAGE` is the only condition this slice sends. Eurotax states that poor or not-roadworthy vehicles are removed from the comparison set, so `POOR` and `NOT_ROADWORTHY` return `NOT_IN_COMPARISON_SET` with amount null and no provider call. |
| First registration | Required on the vehicle, because Eurotax uses age and excludes vehicles with no age. `Vehicle.year` is not a substitute. |
| Source | On a real quote, `EUROTAX_AT_AUTOVALUATION`. Otherwise `source` is null and `sourceState` is `UNKNOWN`. |
| Reference version | The provider's dataset version string. Our contract version is the constant `acp-valuation-contract-1`. |
| NativeID | Not sent and not received. `nativeId: null`, `nativeIdState: NATIVE_ID_UNKNOWN`. |

The public valuation relaunch note says kilometre corrections are included in the Eurotax value, the fixed target mileage is no longer delivered, and the old correction fields stay empty. This contract therefore has no separate mileage-adjustment amount. The quoted amount is the whole market value.

---

## Result families

| Result | When | Stored? | HTTP |
|---|---|---|---|
| `QUOTED` | One amount, currency `EUR`, known source, known `providerAsOf`, known `referenceVersion` | Yes | 201 |
| `UNCERTAIN_IDENTITY` | National code missing, not six digits, equal to the VIN, 17 characters, or equal to `typenschein_no` | No | 422 |
| `AMBIGUOUS_VARIANT` | The fake or future provider returns more than one type for that code. Labels are synthetic in tests. No candidate is selected. | No | 409 |
| `MISSING_DATA` | Mileage, condition, or `first_registration_date` absent | No | 422 |
| `NOT_IN_COMPARISON_SET` | Condition is `POOR` or `NOT_ROADWORTHY` | No | 422 |
| `STALE_VALUATION` | A stored quote whose `providerAsOf` is before today in `Europe/Vienna`. Computed on read. The row is not refreshed and no price changes. | Already stored | 200 on GET |
| `CONFLICT_REPLAY` | The same `Idempotency-Key` is reused with a different `inputSha256` | No new row and no provider call | 409 |
| `REFERENCE_VERSION_UNKNOWN` | A provider body has an amount but no version string | No | 422 |
| `AS_OF_UNKNOWN` | A provider body has an amount but no observation date | No | 422 |
| `CURRENCY_CONFLICT` | Amount currency is not `EUR` | No | 422 |
| `PROVIDER_UNAVAILABLE` | Production provider, `isAvailable()` false | No | 503 |

Same key and the same `inputSha256` return the stored response and do not call the provider again. That is replay, not a conflict.

`STALE_VALUATION` does not delete the row and does not call the provider. A newer quote is a new POST with a new idempotency key. Nothing in that POST writes `purchase_price`, `sale_price`, or `kaufvertrag_snapshot`.

---

## Snapshot purpose

The snapshot records the quote a person saw: which source, which reference version, which as-of date, which mileage and condition, and which national code. It exists so a later reader can tell a stale observation from the price on a purchase or a Kaufvertrag. It is not a cache for the next lookup and it is not a copy of the catalog.

Published Autovista licence clause 5.4 says an API transaction refers to one vehicle, bulk queries are not allowed unless the integration documentation says otherwise, and the results should not be stored for future use. The same clause is in the Polish Autovista licence PDF. Because of that sentence, this slice stores the normalized decision fields and a SHA-256 of the provider body, and it does not store the raw body. Using the row to answer a later quote without a new call is forbidden. Replay is allowed only for the same idempotency key.

Until an order expressly permits retaining that decision record, the disabled provider stays bound and no row is inserted.

---

## Interfaces

These types are the contract. AUT-527 does not add them to the tree. AUT-551 does.

```typescript
export const VEHICLE_VALUATION_PROVIDER = Symbol('VEHICLE_VALUATION_PROVIDER');

export interface VehicleValuationProvider {
  isAvailable(): boolean;
  quote(input: ValuationQuoteInput, signal: AbortSignal): Promise<ValuationQuoteOutput>;
}

export interface ValuationQuoteInput {
  market: 'AT';
  valuationType: 'MARKET_VALUE';
  nationalCode: string;
  mileageKm: number;
  condition: 'ROADWORTHY_AVERAGE';
  requestedAsOf: string;
  currency: 'EUR';
  contractVersion: 'acp-valuation-contract-1';
}

export interface ValuationQuoteOutput {
  result:
    | 'QUOTED'
    | 'AMBIGUOUS_VARIANT'
    | 'REFERENCE_VERSION_UNKNOWN'
    | 'AS_OF_UNKNOWN'
    | 'CURRENCY_CONFLICT';
  amount: string | null;
  currency: 'EUR' | null;
  source: 'EUROTAX_AT_AUTOVALUATION' | null;
  sourceState: 'KNOWN' | 'UNKNOWN';
  providerAsOf: string | null;
  asOfState: 'KNOWN' | 'AS_OF_UNKNOWN';
  referenceVersion: string | null;
  referenceVersionState: 'KNOWN' | 'REFERENCE_VERSION_UNKNOWN';
  nativeId: null;
  nativeIdState: 'NATIVE_ID_UNKNOWN';
  candidates?: { nationalCode: string; label: string }[];
}
```

`quote` receives no VIN, plate, customer name, or Typenschein. The disabled provider rejects with `ServiceUnavailableException` message `VALUATION_PROVIDER_UNAVAILABLE` and does not open a socket. The fake provider returns the fixture case for the test id.

Request body for `POST /api/vehicles/:id/valuations`:

```typescript
export interface CreateVehicleValuation {
  valuationType: 'MARKET_VALUE';
  mileageKm: number;
  condition: 'ROADWORTHY_AVERAGE' | 'POOR' | 'NOT_ROADWORTHY';
  requestedAsOf?: string;
  currency: 'EUR';
}
```

Header `Idempotency-Key` is required, 8 to 80 characters from `A-Za-z0-9-_`. A missing header is `422` `VALUATION_IDEMPOTENCY_KEY_INVALID`.

`inputSha256` is SHA-256 of the canonical JSON object `{ vehicleId, nationalCode, valuationType, mileageKm, condition, requestedAsOf, currency, contractVersion }` with those keys in that order and no extra whitespace.

---

## Database Impact

### New Tables / Columns

Implemented by AUT-551, not by this spec PR.

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| `vehicle_valuation_snapshots` | `id` | uuid | no | Primary key |
| `vehicle_valuation_snapshots` | `tenant_id` | text | no | From the authenticated tenant |
| `vehicle_valuation_snapshots` | `vehicle_id` | uuid | no | FK `Vehicle`, `onDelete: Cascade` |
| `vehicle_valuation_snapshots` | `site_id` | text | yes | Active site at POST for a stock vehicle. Null for `CUSTOMER` |
| `vehicle_valuation_snapshots` | `national_code` | varchar(6) | no | The six digits that were quoted |
| `vehicle_valuation_snapshots` | `valuation_type` | text | no | `MARKET_VALUE` |
| `vehicle_valuation_snapshots` | `mileage_km` | int | no | Request input |
| `vehicle_valuation_snapshots` | `condition` | text | no | `ROADWORTHY_AVERAGE` |
| `vehicle_valuation_snapshots` | `requested_as_of` | date | no | Caller date |
| `vehicle_valuation_snapshots` | `provider_as_of` | date | no | Provider observation date |
| `vehicle_valuation_snapshots` | `currency` | char(3) | no | `EUR` |
| `vehicle_valuation_snapshots` | `amount` | decimal(12,2) | no | Quoted amount only. Failures are not rows |
| `vehicle_valuation_snapshots` | `source` | text | no | `EUROTAX_AT_AUTOVALUATION` |
| `vehicle_valuation_snapshots` | `reference_version` | text | no | Provider version |
| `vehicle_valuation_snapshots` | `contract_version` | text | no | `acp-valuation-contract-1` |
| `vehicle_valuation_snapshots` | `native_id_state` | text | no | Always `NATIVE_ID_UNKNOWN`. No `native_id` column |
| `vehicle_valuation_snapshots` | `input_sha256` | char(64) | no | |
| `vehicle_valuation_snapshots` | `provider_body_sha256` | char(64) | no | Hash only |
| `vehicle_valuation_snapshots` | `idempotency_key` | varchar(80) | no | Unique with `tenant_id` |
| `vehicle_valuation_snapshots` | `created_by` | text | no | Authenticated user id |
| `vehicle_valuation_snapshots` | `created_at` | timestamptz | no | No `updated_at`. The row is immutable |

Index `(tenant_id, vehicle_id, created_at)`. Unique `(tenant_id, idempotency_key)`.

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| `vehicles` | No column change | No |
| `vehicle_purchases` | No change. `purchase_price` stays human-entered | No |
| `vehicle_sales` | No change. `sale_price` and `kaufvertrag_snapshot` stay human-entered | No |

### Deletion Policy Impact

`docs/deletion-policy.md` has the AUT-527 section. There is no snapshot delete route. Vehicle delete is unchanged: it stays blocked while a purchase, sale, or other listed document exists. Cascade runs only when that existing vehicle delete is already allowed.

### State

A snapshot has no status machine. `STALE_VALUATION` is derived by comparing `provider_as_of` with today in `Europe/Vienna`. Conflict and replay do not update a row. ADR-0011 guards are not added because there is no transition.

### Real-time, inventory, finance

Do not add the snapshot to `SUPPORTED_ENTITY_TYPES`. It does not move stock and does not write `VehicleLedgerEntry`. It does not read or bypass `FinanceSettings.lock_date`. Invoice snapshot rules are untouched.

---

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| `POST` | `/api/vehicles/:id/valuations` | `CreateVehicleValuation` plus `Idempotency-Key` | Quote, or one result code above | Tenant JWT. `TECH` receives the existing back-office refusal. Not on the public API key surface |
| `GET` | `/api/vehicles/:id/valuations` | none | Newest first, each row plus computed `stale` | Same |

Stock roles `USED`, `NEW`, and `DEMO` require `vehicle.site_id` to equal the active site from `SiteContextService` in `apps/core-api/src/site/site-context.service.ts`. A mismatch is `404`. A stock vehicle with a null site is `422` `VALUATION_SITE_REQUIRED`. `CUSTOMER` vehicles are tenant-scoped. The snapshot copies the active site only for a stock vehicle, at POST time. A later site switch does not rewrite it.

An unknown vehicle is `404`. The national code in the body is not accepted; the server reads `Vehicle.national_code`.

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|--------------------|
| `POST` | `/api/vehicles/:id/resolve-identity` | No change |
| Purchase and sale writes | existing routes | No change. They remain the only way to set `purchase_price` and `sale_price` |

### OpenAPI Regeneration

AUT-551 runs both commands when the DTOs exist. This spec PR changes no DTO.

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

The vehicle detail page gains a Valuation section. It shows the latest snapshot: amount, currency, source, reference version, both dates, mileage, condition, national code, and `NATIVE_ID_UNKNOWN` when a quote exists. Empty state copy is "No valuation stored." Stale quotes use `StatusBadge` with `STALE_VALUATION`. They stay on screen.

### Layout & Actions

- [x] Page-level action `Request valuation` is top-right.
- [x] Top-left stays title, breadcrumbs, and badges.
- [x] The page header keeps `text-2xl font-semibold tracking-tight`.
- [x] The section subtitle uses `text-slate-500` and states that the figure is a market observation.

### List Pages (if applicable)

- [x] There is no new list page and no create-entity button.
- [x] Search, sort, and row click stay on the existing vehicle list.
- [x] The valuation state uses `StatusBadge`.
- [x] A quote row does not navigate to a purchase or a sale.
- [x] There is no delete action.

### Form Handling

- [x] The request is an explicit submit. It is not a 750 ms auto-save and not save-on-blur, because submit can create an evidence row.
- [x] Mileage and condition are fields on that submit. Saving them does not write `Vehicle.mileage`.

### Real-Time Sync

- [x] The snapshot is not added to `SUPPORTED_ENTITY_TYPES`.
- [x] `dashboard-entity-map.ts` is unchanged.

The screen has no control that copies the amount into a purchase price, a sale price, or a Kaufvertrag. Those forms do not read this snapshot when they save.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `VehicleValuationSection` | vehicle detail, beside the existing identity block | Submit a quote request and render the result code or the stored snapshot |

No change to the identity banner. National code remains labeled `Nationalcode`. Typenschein remains its own field.

---

## Provider contract and follow-up

The provider output is `ValuationQuoteOutput` above. A `QUOTED` output must have a non-null decimal string `amount` with two fractional digits, `currency: "EUR"`, `source: "EUROTAX_AT_AUTOVALUATION"`, `sourceState: "KNOWN"`, an ISO date `providerAsOf`, `asOfState: "KNOWN"`, a non-empty `referenceVersion`, `referenceVersionState: "KNOWN"`, `nativeId: null`, and `nativeIdState: "NATIVE_ID_UNKNOWN"`. Any weaker output is one of the unknown results and stores nothing.

Bounded implementation issue: [AUT-551](https://linear.app/auto-core-platform/issue/AUT-551/implement-disabled-eurotax-at-market-value-port). It adds the disabled port, the table, the two routes, and fixture tests. It does not add a live client.

### Live usage rights, not done

All of the following are absent. This spec does not record a conversation, a purchase, a trial, or a credential.

- A named order for Eurotax Austria AutovistaVALUATION in market AT, with a volume cap and an overage price.
- Written permission to retain the normalized decision record for as long as the vehicle delete rules keep it. Clause 5.4 otherwise says API results should not be stored for future use.
- Confirmation that one-vehicle queries are the only allowed pattern. Bulk and catalog export stay forbidden.
- A decision that VIN lookup is a separate paid product and is not included in this slice.
- The vendor integration document that names the live request fields. Until that document is in the tenant's possession, the adapter stays disabled rather than guessed.
- No sub-licence and no use outside the ordered market. Personal data sent to the vendor, if a later slice sends a VIN or a plate, needs the consents in licence clause 11. Transfer outside the EEA needs the customer's prior written consent under clause 11.5.4. This slice sends neither VIN nor plate.

---

## Testing Plan

### Backend E2E

AUT-551 loads [vehicle-nationalcode-valuation.fixtures.json](./vehicle-nationalcode-valuation.fixtures.json).

- [ ] `quoted-market-value` inserts one snapshot and leaves `purchase_price`, `sale_price`, and `kaufvertrag_snapshot` unchanged.
- [ ] `uncertain-identity-vin-shaped` and `uncertain-identity-equals-typenschein` return 422 and write nothing.
- [ ] `ambiguous-variant` returns 409, stores nothing, and does not pick a candidate.
- [ ] `missing-mileage` returns 422.
- [ ] `stale-valuation` is stale on a read dated 2026-10-15 and does not start a new provider call.
- [ ] `conflict-replay` returns 409 and does not insert a second row.
- [ ] `reference-version-unknown` and `as-of-unknown` store no amount.
- [ ] `provider-unavailable` is the production binding: 503 and no socket.
- [ ] Existing `vehicle-identity.service.spec.ts` assertions stay as they are.

### Frontend

- [ ] Submit a quote on a customer vehicle and on a stock vehicle whose site does not match, and confirm the stock case 404s.
- [ ] Confirm the purchase and sale forms still save the price the person typed after a quote is on screen.

---

## Open Questions

None. The unpublished vendor wire format is a live prerequisite, not a design choice. NativeID stays unknown until a public or licensed document defines it.

---

## References

- [[README|Vault Conventions]]
- [ADR-0028](../../01-ADR/2026-10-15-valuation-separate-from-identity.md)
- [ADR-0021](../../01-ADR/2026-08-28-vehicle-intelligence-catalog-providers.md)
- [registration-document-intake.md](./registration-document-intake.md)
- [BMIMI, Nationaler Code](https://www.bmimi.gv.at/themen/verkehr/strasse/fahrzeuge/fahrzeugtechnik/natcode.html)
- [Eurotax CH identification quickstart](https://eurotax.ch/wp-content/uploads/sites/7/2026/02/JDP-QS-Eurotax-SSM-CH-Identifikation.pdf)
- [Eurotax Austria data solutions](https://eurotax.at/produkt/datenloesungen/)
- [Eurotax Austria valuation webservice relaunch](https://eurotax.at/valuation-webservice-relaunch/)
- [Eurotax Austria FAQ](https://eurotax.at/hilfe-unterstuetzung/)
- [Schwacke data solutions](https://schwacke.de/produkt/datenloesungen/)
- [Schwacke and Eurotax DMS transition](https://schwacke.de/dms-integration-portal-de-at/)
- [Schwacke licence terms](https://schwacke.de/allgemeine-geschaeftsbedingungen/)
- [Autovista Poland licence V0825-01, clause 5.4](https://eurotax.pl/wp-content/uploads/sites/13/2026/02/PL_Autovista_Licence-Agreement_EN_PL_V0825-01-1.pdf)
- [Autovista API product page](https://autovista.com/product/autovista-api/)
- [JD Power Autovista API](https://www.jdpower.com/business/autovista-api/)
- [Autovista API service list, Identification versus Valuation](https://autovista24.autovistagroup.com/wp-content/uploads/sites/5/2023/11/AuovistaAPIs-Overview-1.pdf)
- [Autovista VIN API](https://autovista.com/product/vin-api/)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b |
| Milestone | M5 Snap & Done and vehicle enrichment |
| Issues | AUT-527, AUT-551, AUT-516 |
