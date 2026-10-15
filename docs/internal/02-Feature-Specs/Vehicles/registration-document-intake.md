---
title: "Zulassungsschein intake, Nationalcode, and duplicate review"
date: "2026-10-15"
module: "Vehicle"
status: draft
linear-project: "Vehicle Intelligence & Parts Catalog"
linear-milestone: ""
tags:
  - feature-spec
  - vehicle
  - workshop
---

# Zulassungsschein intake, Nationalcode, and duplicate review

## Summary

A workshop user photographs or uploads an Austrian Zulassungsschein. The product reads evidenced fields, matches them to tenant customers and vehicles, and waits for a person to confirm the critical identity fields before anything is saved. Low confidence never creates a customer, vehicle, or workshop order. Nationalcode is stored as its own value. CRM identity stays tenant-wide. The workshop order, when the person also sends the existing order fields, is created on the site captured with the upload.

Checked against commit `d1bb14539b71d4ad3d03ff0b06c595d8a3700c8c`. Synthetic contract data is in [registration-document-intake.fixtures.json](./registration-document-intake.fixtures.json). The holder in every fixture is `pilot customer`.

This document is the AUT-516 deliverable. It does not enable a live extractor and it does not send a document anywhere.

---

## User Stories

- As a **workshop advisor**, I want a photo or PDF of an Austrian Zulassungsschein turned into reviewed fields so that I can attach the right customer and vehicle without typing the VIN.
- As a **workshop advisor**, I want an existing customer, an existing vehicle, several duplicates, or a conflicting holder called out as separate review cases so that I choose the row instead of the software guessing.
- As a **tenant admin**, I want registration scans kept under their own retention rules so that a letterhead upload is never treated as permission to process a registration document.

---

## Verified current behavior

| Fact | Where it lives |
|---|---|
| `POST /api/workshop/register` creates or updates a tenant vehicle from a typed VIN. A normalized VIN match updates that vehicle, including `customer_id`. A unique violation on create becomes `409` with message `Vehicle was created by another intake; please retry`. | `executeRegisterIntake`, `createNewIntakeVehicle` |
| VIN match is tenant-wide. Plate is not unique. Stored VINs are unique per tenant when not null (`vehicles_tenant_id_vin_normalized_key`). Normalization is trim plus uppercase. | `normalizeVehicleIdentityValue`, migration `20260829170000_harden_vehicle_identity_storage` |
| `POST /api/workshop/orders` binds the order to the session's active site. A site switch after simulation returns `422` with message `Select the site where this action was simulated before applying it`. An order on another site is `404` `Workshop order ${id} not found`. | `resolveCreateSiteId`, `assertActiveSiteMatch` |
| Active site requires an active tenant membership and an active site membership. Failure is `422` and the message tells the caller to use `GET /api/me/sites` then `PATCH /api/me/active-site`. The thrown body includes `code: ACTIVE_SITE_REQUIRED`, and the global filter removes `code` because that value is not client-safe. | `apps/core-api/src/site/site-context.service.ts`, `GlobalExceptionFilter` |
| Vehicle identity resolution is a sandbox VIN decoder. It writes make, model, and related decoder fields. It has no Nationalcode. | `SandboxVehicleIdentityProvider` |
| Letterhead extraction uses prompt `document-branding-v1`, PNG or PDF source files up to 10 MiB, and provider symbol `DOCUMENT_BRAND_EXTRACTION_PROVIDER`. The disabled provider answers `503` `BRAND_EXTRACTION_UNAVAILABLE`. | `document-branding-extraction-prompt.ts`, `document-branding-limits.ts` |
| There is one proposal queue: `AgentProposal`. `HUMAN_ONLY` approval throws `422` `HUMAN_ONLY proposals must be performed manually`. An MCP write at tier `HUMAN_ONLY` logs `REFUSED` and throws `403` whose message starts with `not_permitted`. It does not insert a proposal. | `AgentProposal`, `mcp-write-pipeline.service.ts` |
| Customer, vehicle, and workshop-order deletes are not MCP tools. | `MCP_NEVER_EXPOSED_ACTIONS` |
| `Vehicle` already has `vin`, `plate`, `typenschein_no`, `registration_certificate_no`, `first_registration_date`, `co2_wltp_g_km`, `co2_nedc_g_km`, `hsn`, and `tsn`. It has no Nationalcode column. CO₂ must be an integer from 0 through 600. First registration must be a real `YYYY-MM-DD` and not after today in `Europe/Vienna`. | `schema.prisma`, `vehicle-regulatory.validation.ts` |
| The intake dialog searches VIN, plate, and customer, then either selects a vehicle or calls register. | `WorkshopOrderIntakeDialog.tsx` |

`register` today can change `customer_id` on a VIN match. This feature must not do that unless the person submits the ownership correction below.

Do not import `SiteContextService` from `apps/core-api/src/common/services/site-context.service.ts`. Workshop intake uses the class in `apps/core-api/src/site/site-context.service.ts`.

---

## Decisions

No separate ADR. Tenancy, the stock ledger, and fiscal documents stay as they are. The letterhead ADR stays limited to letterheads. The choices below are the contract for implementation.

1. Registration extraction has its own provider symbol, prompt version `registration-document-v1`, storage prefix, and retention. It must not call `buildDocumentBrandingExtractionPrompt`, `DOCUMENT_BRAND_EXTRACTION_PROVIDER`, or the letterhead asset tables.
2. The production binding is a disabled provider. Tests bind a fake provider that returns rows from the fixture file. Neither binding opens a network connection.
3. A live model is blocked until [AUT-395](https://linear.app/auto-core-platform/issue/AUT-395) is done. This spec does not open another HUMAN waiting issue and does not name a vendor as approved.
4. Nationalcode is not a VIN, not `typenschein_no`, not German ZB I field 2.1/2.2, and not `hsn`/`tsn`. Valuation and Eurotax or Schwacke mapping belong to AUT-527.
5. Agents use the existing `AgentProposal` queue. The action `registration_intake.apply` cannot run as `AUTO`. `HUMAN_ONLY` is refused and is not queued. A person confirms in the workshop UI, or a supervisor applies a `PROPOSE` row.
6. The upload stores `site_id` from `SiteContextService.getSiteId()` at that moment. Apply uses the stored site. A later active-site change does not retarget the document.

---

## Scope

In scope: one Austrian Zulassungsschein (Vorderseite and optional Rückseite), evidenced fields, local matching, human confirmation, ownership correction as an explicit second choice, and the error contract in the fixture file.

Out of scope:

- Authority lookups, FinanzOnline, and any register scrape.
- Changing `customer_id` because the holder text differs, without the correction request.
- Eurotax, Schwacke, or any catalog price. AUT-527.
- Reusing the letterhead prompt or sending registration bytes to Jev, OpenRouter, or any other unapproved processor.
- German ZB I as a supported document.
- Editing invoices, stock, or NoVA.

---

## Document and fields

### Files

| Rule | Value |
|---|---|
| Count | 1 or 2 files per intake |
| Types | `image/jpeg`, `image/png`, `application/pdf`, detected from bytes |
| Size | 10 MiB (10 × 1024 × 1024) per file |
| PDF | Pages 1 and 2 are read. Page 1 is the front, page 2 is the back. Further pages set warning `EXTRA_PAGES_IGNORED` and are not read |
| Image | One side per file. The client labels `FRONT` or `BACK` |
| Reject | Empty file, MIME that does not match the bytes, encrypted or unreadable PDF |

A JPEG starts with `FF D8 FF`. A PNG starts with the eight-byte PNG signature. A PDF starts with `%PDF-`. Anything else is `400` `REGISTRATION_INTAKE_UNSUPPORTED_FILE`.

### Field dictionary

Each extracted field is `{ raw, normalized, source, uncertainty }`. `source` is null or `{ page, region }` with `page` starting at 1 and `region` in unit intervals: `x` and `y` in `[0, 1]`, `width` and `height` in `(0, 1]`, and `x + width <= 1`, `y + height <= 1`. `uncertainty` is null only when the side that carries the field was not uploaded. Otherwise it is a number from 0 through 1. A field is low confidence when `uncertainty` is greater than `0.34`, when `normalized` is null and the absence is not `CONFIDENT`, or when the value fails the check in the table.

| Field | Document label | Normalized value | Written to | Not written to |
|---|---|---|---|---|
| `vin` | `(E)` FIN | `normalizeVehicleIdentityValueOrNull`. Must be 17 characters from `A-Z` and `0-9` excluding `I`, `O`, and `Q` | `Vehicle.vin` | `national_code`, `typenschein_no`, `hsn`, `tsn` |
| `plate` | `(A)` Kennzeichen | Same trim-and-uppercase helper. Spaces stay. `W SYNTH 1` does not match `WSYNTH1` | `Vehicle.plate` | |
| `holder` | `(C.1.2)` plus `(C.1.1)`, or one line `pilot customer` | `{ firstName, lastName }` after trim. The fixture line `pilot customer` becomes first `pilot` and last `customer` | New or chosen `Customer.first_name` / `last_name` | Address, phone, and email are not overwritten on an existing customer |
| `nationalcode` | Printed label `Nationalcode` | NFC, trim, remove internal spaces, uppercase, then `^[A-Z0-9]{2,16}$` | `Vehicle.national_code` | VIN, Typenschein, HSN, TSN, `identity_keys` |
| `firstRegistration` | `(B)` | `YYYY-MM-DD` via `assertVehicleRegulatoryFields` | `Vehicle.first_registration_date` | |
| `co2` | `(V.7)` | Integer 0 through 600. `cycle` is `WLTP` or `NEDC` from the printed unit. A missing unit leaves the value unstored and adds review `CO2_CYCLE_UNKNOWN` | `co2_wltp_g_km` or `co2_nedc_g_km` | The other CO₂ column |

If the Nationalcode candidate equals the normalized VIN, or is 17 characters, `uncertainty` is forced to 1 and the warning is `NATIONALCODE_LOOKS_LIKE_VIN`. The column stays null.

A German heading `Zulassungsbescheinigung Teil I` sets `documentKind` to `DE_ZB_I`. Field 2.1/2.2 is not a Nationalcode and is not `typenschein_no`.

`documentKind` `AT_ZULASSUNGSSCHEIN` is the only kind that can be applied.

### Review cases

More than one case can be present. Apply does not pick among them.

| Case | When |
|---|---|
| `EXISTING_CUSTOMER` | Exactly one tenant customer matches the holder email or the normalized first and last name |
| `EXISTING_VEHICLE` | Exactly one tenant vehicle has the normalized VIN, or, when VIN is confidently absent, exactly one vehicle has the normalized plate |
| `DUPLICATE_CUSTOMERS` | More than one customer matches |
| `DUPLICATE_VEHICLES` | More than one vehicle matches |
| `OWNERSHIP_CONFLICT` | The matched vehicle has a `customer_id` and it is not the chosen customer |
| `CONFLICTING_VIN` | A selected vehicle id was sent and its VIN differs from the document VIN |
| `MISSING_NATIONALCODE` | Nationalcode absence is `CONFIDENT` |
| `WRONG_DOCUMENT` | `documentKind` is not `AT_ZULASSUNGSSCHEIN` |
| `ILLEGIBLE` | Every identity field is unreadable |
| `LOW_CONFIDENCE` | Any of VIN, plate, or holder is low confidence, or a present Nationalcode is low confidence |
| `BACK_NOT_SUPPLIED` | CO₂ was not on an uploaded side. This warning does not block apply |

Matching uses two queries, not one query per field: `findMany` customers for the tenant with `take: 25` and the email or name predicate, and `findMany` vehicles for the tenant with `take: 25` and `vin` equal to the normalized VIN or `plate` equal to the normalized plate. A 25-row cap adds `DUPLICATE_CUSTOMERS` or `DUPLICATE_VEHICLES`. Email stays unique per tenant, so an email hit is a single customer.

---

## Interfaces

These types are the contract. They are not added to the tree by AUT-516.

```typescript
export const REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER = Symbol(
  'REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER',
);

export interface RegistrationDocumentExtractionProvider {
  isAvailable(): boolean;
  getMetadata(): { providerId: string; modelId: string };
  extract(input: {
    pages: { page: number; png: Buffer }[];
    promptVersion: 'registration-document-v1';
    signal: AbortSignal;
  }): Promise<{
    documentKind: 'AT_ZULASSUNGSSCHEIN' | 'DE_ZB_I' | 'OTHER' | 'UNKNOWN';
    warnings: string[];
    fields: Record<string, RegistrationFieldEvidence>;
  }>;
}

export interface RegistrationFieldEvidence {
  raw: string | null;
  normalized: string | number | { firstName: string; lastName: string } | null;
  source: {
    page: number;
    region: { x: number; y: number; width: number; height: number };
  } | null;
  uncertainty: number | null;
  absence?: 'CONFIDENT';
  cycle?: 'WLTP' | 'NEDC' | null;
}
```

The disabled provider's `isAvailable()` is false. `extract` rejects with `ServiceUnavailableException` `REGISTRATION_EXTRACTION_UNAVAILABLE` and performs no I/O. The fake provider returns the `extractions` object for a fixture id. Unknown bytes return the `illegible` extraction. The prompt file is new and contains only the field dictionary above.

Candidate snapshot stored on the intake, produced by the match queries:

```typescript
export interface RegistrationMatchSnapshot {
  customers: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; vin: string | null; plate: string | null; customerId: string | null }[];
  cases: string[];
}
```

Apply body. Critical identity values must equal the stored normalized evidence. `nationalcode` must be the normalized code, or `null` when the case is `MISSING_NATIONALCODE`. Omitting a critical key is a mismatch.

```typescript
export interface ApplyRegistrationIntake {
  vin: string;
  plate: string;
  holder: { firstName: string; lastName: string };
  nationalcode: string | null;
  firstRegistration: string | null;
  co2: { value: number; cycle: 'WLTP' | 'NEDC' } | null;
  customerId?: string;
  vehicleId?: string;
  ownershipCorrection?: {
    expectedCustomerId: string | null;
    nextCustomerId: string;
  };
  workshopOrder?: {
    odometer: number;
    fuelLevel: number;
    reportedIssue?: string;
  };
}
```

`ownershipCorrection` is the only way `Vehicle.customer_id` changes. Without it, an `OWNERSHIP_CONFLICT` apply returns the ownership conflict response and writes nothing.

When `workshopOrder` is present, the order is created in the same transaction through `executeCreateWorkshopOrder` with `expectedSiteId` set to the intake's stored `site_id`. Odometer and fuel follow `CreateWorkshopOrderDto`. When `workshopOrder` is absent, no order is created and the existing intake dialog can still call `POST /api/workshop/orders` later; that call is a different request and uses the active site at that later time. The registration document itself stays on the original site.

---

## HTTP contract

Prefix `/api`. Tenant id comes from the authenticated context. Every route calls `getSiteId()` before it reads the intake, which checks the active membership. Create also requires `Idempotency-Key` of 1 to 128 characters.

| Method | Route | Result |
|---|---|---|
| `POST` | `/workshop/registration-intakes` | Multipart files. `201` intake in `AWAITING_REVIEW` or `FAILED`. Replay of the same key and the same request hash returns `201` and the same id. The provider runs once |
| `GET` | `/workshop/registration-intakes/:id` | `200` evidence, cases, and candidates. No file bytes |
| `POST` | `/workshop/registration-intakes/:id/apply` | `200` when the confirmation matches. See responses |
| `POST` | `/workshop/registration-intakes/:id/abort` | `200` `{ state: "ABORTED", bytesDeleted: true }` from `QUEUED`, `RUNNING`, or `AWAITING_REVIEW` |
| `DELETE` | `/workshop/registration-intakes/:id` | `204` before apply. After apply, the applied-delete response |

States: `UPLOADED`, `QUEUED`, `RUNNING`, `AWAITING_REVIEW`, `APPLIED`, `ABORTED`, `FAILED`. Apply accepts only `AWAITING_REVIEW`. A losing `updateMany` returns `409` `REGISTRATION_INTAKE_STATE_CHANGED: The intake changed; please reload.`

### REST and MCP

REST JSON is what `GlobalExceptionFilter` writes: `statusCode`, `message`, `error`, and `code` only when the code is listed in `CLIENT_SAFE_HTTP_ERROR_CODES`. Detail keys are forwarded only when listed next to that code. The apply slice adds every new code from the fixture file to that set. `503` is not in the filter's status-name switch, so `error` is `SERVICE_UNAVAILABLE` (`HttpStatus[503]`).

MCP does not return `statusCode`. A thrown `HttpException` becomes a tool result with `isError: true` and text equal to `exception.message`. That is why each new message starts with its code. Policy refusal stays the existing message that starts with `not_permitted`. `ZodError` stays a schema failure with tier `NOT_EVALUATED` and log status `FAILED`.

Expected bodies are the `responses` object in the fixture file. Reused strings, copied from current code, have no `code` property:

- `Vehicle was created by another intake; please retry`
- `Vehicle holder changed while confirming intake; please retry` is new, and it also has no `code`, matching the VIN race shape
- `Select the site where this action was simulated before applying it`
- The active-site message quoted above, still without `code`

`not_permitted` on MCP is `403` on the HTTP exception and is not a REST `code` field. The agent log row is `tier: HUMAN_ONLY`, `status: REFUSED`, and no `AgentProposal` row is inserted.

### Parallel create, replay, abort, ownership

| Situation | Response |
|---|---|
| Two creates with one idempotency key and one hash | One row. Second response is the first body. Provider call count is 1 |
| Same key, different hash | Idempotency conflict in the fixture |
| Two applies create the same new VIN | One insert wins. The other is the existing `409` `Vehicle was created by another intake; please retry` |
| Apply after abort | State-changed conflict. No customer and no vehicle |
| Abort while `RUNNING` | `200` `ABORTED`, bytes deleted. A late provider result with the old lease token does not write |
| Delete before apply | `204`, bytes deleted |
| Delete after apply | Applied-delete response. Customer, vehicle, and order stay |
| Apply on `DE_ZB_I` or illegible evidence | Wrong-document or illegible response. No writes |
| Apply when VIN, plate, or holder is low confidence, or a present Nationalcode is low confidence | Low-confidence response. No writes, including no proposal that would create those rows |
| Confirmed VIN differs from evidence, or selected vehicle VIN differs | Confirmation mismatch, or conflicting-VIN response |
| Several customers or plate vehicles | Ambiguous-match response. The candidate ids are on the intake. None is selected |
| Missing Nationalcode, and the body sends `nationalcode: null` | Allowed. VIN is not copied into `national_code` |
| Missing Nationalcode, and the body sends the VIN or a Typenschein value as `nationalcode` | Confirmation mismatch |
| Vehicle customer differs and `ownershipCorrection` is absent | Ownership conflict. `customer_id` unchanged |
| `ownershipCorrection.expectedCustomerId` matches, and `nextCustomerId` is the confirmed holder | `customer_id` updates in the same `updateMany` that checks VIN, plate, and the expected customer. Count `0` returns `Vehicle holder changed while confirming intake; please retry` |
| Agent tool, tier `PROPOSE`, evidence is confirmable | `{ status: "needs_approval", pending_action_id }` and no customer, vehicle, or order until `POST /api/agent-proposals/:id/apply` |
| Agent tool, tier `HUMAN_ONLY` or disabled | `not_permitted` text, log `REFUSED`, no proposal |
| Supervisor applies a `HUMAN_ONLY` proposal | Existing `422` `HUMAN_ONLY proposals must be performed manually` |

The MCP tool name is `propose_registration_intake`. Its policy action is `registration_intake.apply`. The platform floor is `PROPOSE`, clamped the same way as `propose_line_item`, so a tenant cannot set `AUTO`. There is no MCP tool for upload bytes, abort, or delete. Those stay on the REST routes. `customer.delete`, `vehicle.delete`, and `workshop_order.delete` stay unregistered.

---

## Database Impact

### New Tables / Columns

`Vehicle.national_code` is `String?` `@db.VarChar(16)`, mapped to `national_code`. Index `(tenant_id, national_code)` is not unique: many vehicles share a type code.

`RegistrationDocumentIntake` (`registration_document_intakes`):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | |
| `tenant_id` | UUID | no | FK tenant, `onDelete: Restrict` |
| `site_id` | UUID | no | Site captured at create. FK `(tenant_id, site_id)` |
| `idempotency_key` | varchar(128) | no | Unique with `tenant_id` |
| `request_hash` | char(64) | no | SHA-256 of the create request |
| `state` | enum | no | See states |
| `document_kind` | varchar(32) | yes | |
| `evidence` | Json | yes | Field evidence. No image bytes |
| `match_snapshot` | Json | yes | Candidates and cases |
| `lease_token` | varchar(64) | yes | Cleared when the job ends |
| `provider_id` | varchar(64) | yes | `disabled` or `fake` until a live provider exists |
| `prompt_version` | varchar(64) | yes | `registration-document-v1` |
| `captured_by_user_id` | UUID | yes | |
| `applied_customer_id` | UUID | yes | |
| `applied_vehicle_id` | UUID | yes | |
| `applied_workshop_order_id` | UUID | yes | |
| `expires_at` | timestamptz | yes | 30 days after create while unapplied |
| `createdAt` / `updatedAt` | timestamptz | no | |

Unique `(tenant_id, id)` and `(tenant_id, idempotency_key)`. Index `(tenant_id, site_id, createdAt)` and `(expires_at)`.

Page bytes live in object storage at `registration-intakes/{tenantId}/{intakeId}/page-{n}`. They are not a `DocumentBrandAsset`.

### Modified Tables

| Table | Change | Migration Required? |
|---|---|---|
| `vehicles` | Add `national_code` and the non-unique index | Yes |
| `customers`, `workshop_orders` | No column changes. Apply may insert a customer or an order through existing creates | No |

### Deletion Policy Impact

Add these rules to `docs/deletion-policy.md` in the schema slice:

| Entity | Delete | Rule |
|---|---|---|
| `RegistrationDocumentIntake` | Before `APPLIED` | Hard delete the row and the page objects from `UPLOADED`, `QUEUED`, `FAILED`, `ABORTED`, and `AWAITING_REVIEW` |
| `RegistrationDocumentIntake` | `APPLIED` | Refuse. The row is audit. Page objects are already gone |
| `Vehicle.national_code` | n/a | Follows the existing vehicle delete rule |

Abort and delete remove page objects before the row commit. A failed object delete leaves the row in place and returns `503` `REGISTRATION_INTAKE_BYTES_REMAIN: The file could not be deleted.` so a retry can finish.

Unapplied rows past `expires_at` are deleted by the same cleanup path. Applied rows are removed only by tenant purge.

### Tenant restore

The schema slice runs `tools/tenant-restore/generate-tenant-restore-sql.mjs` and `node tools/tenant-restore/verify-table-list.mjs`. The new table has `tenant_id`, so the generator includes it. Page objects are not in the SQL dump; restore of an unapplied intake may have a row whose bytes are already gone, and readers treat missing bytes as `ABORTED`.

### Real-Time Sync

Do not add `RegistrationDocumentIntake` to `SUPPORTED_ENTITY_TYPES` or `dashboard-entity-map.ts`. Customer, vehicle, and workshop-order writes already emit `CUSTOMER`, `VEHICLE`, and `WORKSHOP_ORDER`.

No inventory ledger change. No invoice and no `lock_date` change.

---

## API Contract Changes

### New Endpoints

Listed in the HTTP contract. Auth is the authenticated tenant user. `getSiteId()` enforces the active membership. Proposal approve stays on `POST /api/agent-proposals/:id/apply` and still requires `assertSupervisorAccess` (`OWNER`, `ADMIN`, or `ADVISOR`). `TenantMemberRole` in Prisma is `OWNER`, `ADMIN`, `TECH`, `SALES`. `ADVISOR` is only the proposal-supervision role string. A `SALES` user confirms through the workshop route, not through proposal approve, unless their auth role is `ADVISOR`.

### Modified Endpoints

| Method | Route | Change Description |
|---|---|---|
| `POST` | `/api/workshop/register` | Unchanged. The dialog stops calling it for a document intake and calls apply instead |
| `POST` | `/api/workshop/orders` | Unchanged. Apply may call `executeCreateWorkshopOrder` internally |

### OpenAPI Regeneration

Owned by the apply slice, after the DTOs exist:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

Both generated files ship in that slice's pull request.

---

## UX Compliance

The change is a step inside `WorkshopOrderIntakeDialog`, not a new list page.

### Layout & Actions

- [x] The dialog keeps its current footer actions. No new page header.
- [x] Page-level create and save rules are unchanged because this is not a new page.
- [ ] List-page rules do not apply.
- [x] Review state uses `StatusBadge`.
- [x] Confirmation is an explicit submit. It is not a 750 ms auto-save, because submit creates customer, vehicle, and maybe an order.

The dialog shows raw and normalized values, the page and region, and the uncertainty. Low-confidence critical fields have no save action. Wrong document, illegible, duplicate, conflicting VIN, and ownership conflict each have their own copy. Ownership changes only through a second control that posts `ownershipCorrection`. Nationalcode is labeled `Nationalcode`, with the existing Typenschein hint left on the Typenschein field.

### Real-Time Sync

- [x] No new dashboard entity.
- [x] Existing customer, vehicle, and workshop-order events stay as they are.

---

## Component Design

| Component | Location | Purpose |
|---|---|---|
| `WorkshopOrderIntakeDialog` | `apps/core-web/src/components/workshop/WorkshopOrderIntakeDialog.tsx` | Adds the upload step and renders the review cases. It does not decide matches |
| `RegistrationDocumentReview` | `apps/core-web/src/components/workshop/RegistrationDocumentReview.tsx` | Shows evidence and posts apply, abort, or delete |

Business rules stay in the API. The client displays the server cases and the server error `code` when the filter returns one.

---

## Provider and retention

| Binding | Behavior |
|---|---|
| Production | Disabled provider. Create returns the fixture's `providerUnavailable` response when extraction is requested and `isAvailable()` is false |
| Test | Fake provider. Reads the fixture JSON. No network |
| Live | Not part of any slice here. AUT-395 must be finished first. No registration image, PDF, or raw holder line is sent to Jev or to an unapproved processor |

Retention: page bytes are deleted on abort, on delete, on apply, and when an unapplied intake expires at 30 days. Evidence JSON remains on an applied row because those values are the ones written to the customer and vehicle. Letterhead quotas, idempotency indexes, and the 30-day branding source rule are not reused; this intake has its own idempotency unique key and its own 30-day `expires_at`.

---

## Implementation slices

Each backend area has one owner. Later slices may call the earlier slice's module. They do not reimplement it.

| Slice | Owns | Does not own |
|---|---|---|
| S1 Schema | Prisma models and `national_code`, migration, `docs/deletion-policy.md`, tenant-restore SQL regeneration and `verify-table-list.mjs` | HTTP, provider, UI |
| S2 Upload | Routes for create, get, abort, and delete; byte storage; idempotency; disabled provider; fake provider in tests; MIME and size checks | Match queries, apply writes |
| S3 Evidence | Prompt `registration-document-v1`, running the fake provider, storing field evidence, lease token so a late result cannot write | Customer and vehicle writes |
| S4 Match | The two `findMany` queries and the review-case snapshot | Apply |
| S5 Apply | Exact confirmation, regulatory checks, customer and vehicle writes, ownership `updateMany`, optional workshop order at the stored site, client-safe error codes, OpenAPI and web types | MCP tool registration, dialog layout |
| S6 UI | The dialog step and `RegistrationDocumentReview` | Any rule that is not already enforced in S5 |
| S7 MCP | `propose_registration_intake`, `PROPOSE` clamp, `HUMAN_ONLY` refusal, agent-facing tool text, no delete tool | A second proposal table |

S2 through S7 are not started by AUT-516. A live provider is not an eighth slice.

---

## Testing Plan

Implementation tests load [registration-document-intake.fixtures.json](./registration-document-intake.fixtures.json). They do not weaken existing intake assertions.

### Backend

- [ ] Create from `front-clear` plus `back-clear` stores both pages and merges CO₂ onto the evidence.
- [ ] `wrong-document-zb-i`, `illegible`, `conflicting-vin`, `missing-nationalcode`, and `multiple-duplicates` produce the fixture extractions and the fixture error responses.
- [ ] Parallel create and replay: one row, one provider call; a different hash returns the idempotency conflict.
- [ ] Abort and delete remove bytes; delete after apply returns the applied-delete body.
- [ ] Ownership correction updates `customer_id` only when `expectedCustomerId` matches; a stale holder returns the retry message and leaves the row unchanged.
- [ ] Low confidence and a mismatched confirmation write neither customer nor vehicle.
- [ ] `HUMAN_ONLY` does not insert `AgentProposal`. `PROPOSE` returns `needs_approval`.
- [ ] Existing files `workshop-intake.e2e-spec.ts` and `vehicle-identity.service.spec.ts` still pass. They are not proof of this feature.

### Frontend

- [ ] The dialog blocks save on low confidence, requires a choice when several duplicates are listed, and asks for a separate confirmation before it posts `ownershipCorrection`.

---

## Open Questions

None for this contract. Live processor approval stays on AUT-395. Catalog valuation stays on AUT-527.

---

## References

- [registration-document-intake.fixtures.json](./registration-document-intake.fixtures.json)
- `apps/core-api/src/workshop/workshop-intake-vehicle.helpers.ts`
- `apps/core-api/src/vehicle/vehicle-identity.service.ts`
- `apps/core-api/src/vehicle/vehicle-identity.util.ts`
- `apps/core-api/src/vehicle/vehicle-regulatory.validation.ts`
- `apps/core-api/src/document-branding/document-branding-extraction.service.ts`
- `apps/core-api/src/document-branding/document-branding-extraction-prompt.ts`
- `apps/core-api/src/site/site-context.service.ts`
- `apps/core-api/src/common/filters/global-exception.filter.ts`
- `apps/core-api/src/common/errors/client-safe-http-error-codes.ts`
- `apps/core-api/src/mcp/mcp-write-pipeline.service.ts`
- `apps/core-web/src/components/workshop/WorkshopOrderIntakeDialog.tsx`
- `docs/deletion-policy.md`
- `docs/internal/01-ADR/2026-09-27-legal-entity-document-branding.md`
- `docs/internal/01-ADR/2026-08-31-site-operational-scope.md`

---

## Linear Tracking

| Field | Value |
|---|---|
| Project | Vehicle Intelligence & Parts Catalog |
| Milestone | |
| Issues | AUT-516. Blocks AUT-537. Related: AUT-395, AUT-527 |
