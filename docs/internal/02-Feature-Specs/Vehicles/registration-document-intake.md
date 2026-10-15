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

A workshop user photographs or uploads an Austrian Zulassungsschein. The product reads evidenced fields, matches them to tenant customers and vehicles, and waits for a person to confirm the critical identity fields before anything is saved. Low confidence never creates a customer, vehicle, or workshop order. Nationalcode is stored as its own value. CRM identity stays tenant-wide. A workshop order is a later call, on the site captured with the upload, after the customer and vehicle commit.

Checked against commit `d1bb14539b71d4ad3d03ff0b06c595d8a3700c8c`. Synthetic contract data is in [registration-document-intake.fixtures.json](./registration-document-intake.fixtures.json). The holder in every fixture is `pilot customer`.

This document is the AUT-516 deliverable. It does not enable a live extractor and it does not send a document anywhere.

---

## User Stories

- As a **workshop advisor** (`SALES`), I want a photo or PDF of an Austrian Zulassungsschein turned into reviewed fields so that I can attach the right customer and vehicle without typing the VIN.
- As a **workshop advisor**, I want an existing customer, an existing vehicle, several duplicates, or a conflicting holder called out as separate review cases so that I choose the row instead of the software guessing.
- As a **tenant admin**, I want registration scans kept under their own retention rules so that a letterhead upload is never treated as permission to process a registration document.

---

## Verified current behavior

| Fact | Where it lives |
|---|---|
| `Vehicle.make`, `model`, and `year` are required. `createNewIntakeVehicle` writes all three. `RegisterIntakeDto.year` is an integer of at least 1900. | `schema.prisma`, `createNewIntakeVehicle`, `register-intake.dto.ts` |
| `POST /api/workshop/register` creates or updates a tenant vehicle from a typed VIN. A normalized VIN match updates that vehicle, including `customer_id`. A plate change also writes `VEHICLE_IDENTITY_RESET` and clears `identity_resolution_token`. The `updateMany` guard includes `identity_resolution_generation` and `identity_resolution_token`. A unique violation on create becomes `409` with message `Vehicle was created by another intake; please retry`. A lost guard becomes `409` `Vehicle VIN or plate changed while registering intake; please retry`. | `executeRegisterIntake`, `updateExistingIntakeVehicle`, `createNewIntakeVehicle` |
| VIN match is tenant-wide. Plate is not unique. Stored VINs are unique per tenant when not null (`vehicles_tenant_id_vin_normalized_key`). Normalization is trim plus uppercase. Prisma string filters are case-sensitive unless `mode: 'insensitive'` is set. | `normalizeVehicleIdentityValue`, migration `20260829170000_harden_vehicle_identity_storage` |
| `executeCreateWorkshopOrder` loads the customer and vehicle with `services.prisma`, then opens its own `prisma.$transaction`. Rows created in an outer transaction are invisible to it. Passing `expectedSiteId` that differs from the active site throws `422` `Select the site where this action was simulated before applying it`. | `workshop-intake-create.helpers.ts` |
| An order on another site is `404` `Workshop order ${id} not found`. | `assertActiveSiteMatch` |
| Active site requires an active tenant membership and an active site membership. Failure is `422` and the message tells the caller to use `GET /api/me/sites` then `PATCH /api/me/active-site`. The thrown body includes `code: ACTIVE_SITE_REQUIRED`, and the global filter removes `code` because that value is not client-safe. | `apps/core-api/src/site/site-context.service.ts`, `GlobalExceptionFilter` |
| Vehicle identity resolution is a sandbox VIN decoder. It writes make, model, and related decoder fields. It has no Nationalcode. | `SandboxVehicleIdentityProvider` |
| Letterhead extraction uses prompt `document-branding-v1`, PNG or PDF source files up to 10 MiB, and provider symbol `DOCUMENT_BRAND_EXTRACTION_PROVIDER`. The disabled provider answers `503` `BRAND_EXTRACTION_UNAVAILABLE`. | `document-branding-extraction-prompt.ts`, `document-branding-limits.ts` |
| There is one proposal queue: `AgentProposal`. `resolve` throws `400` `Unsupported action type for automatic execution: ${actionType}` for an unknown type. `evaluateAgentPolicyRules` returns tier `HUMAN_ONLY` and reason `unknown_action_fail_closed` when no platform rule exists. A disabled rule returns `rule_disabled_fail_closed`. `isHumanOnlyFloorAction` is true for any action that ends with `.delete`. | `PendingActionExecutorService`, `agent-policy.evaluator.ts`, `agent-policy-floor.ts` |
| MCP write tools are seeded as platform rows. `effectiveMcpWriteTier` clamps only the literal tool `propose_line_item` from `AUTO` to `PROPOSE`. A tenant tier looser than the platform row is `422` `AGENT_POLICY_LOOSER_THAN_PLATFORM`, and the database trigger is `agent_policy_tenant_tier_looser_than_platform`. | `MCP_WRITE_POLICY_ACTION_TYPES`, `mcp-write-tier.util.ts`, `20261005090000_aut_400_mcp_write_policy_actions` |
| `HUMAN_ONLY` approval throws `422` `HUMAN_ONLY proposals must be performed manually` before policy re-evaluation. An MCP write at tier `HUMAN_ONLY` logs `REFUSED` and throws `403` whose message starts with `not_permitted`. It does not insert a proposal. | `agent-proposal-decision.service.ts`, `mcp-write-pipeline.service.ts` |
| `assertSiteMatchesSimulation` runs only for `workshop_order.create` and throws `422` `Select the site where this action was simulated before applying it`. `submitPendingAction` captures a site only for that same action and throws `422` `The active site changed while the pending action was simulated`. `McpWritePipeline.assertActiveSiteUnchanged` throws `409` with that same text when `buildExecutionContext().site_id` changes during the preview. | `agent-proposal-decision.service.ts`, `agent-proposal-submission.service.ts`, `mcp-write-pipeline.service.ts` |
| MCP preview runs `execute` inside `DryRunService.executeInRollbackTransaction`. Object-store deletes do not roll back. `DryRunStorage.isDryRun()` is the flag those paths set. | `dry-run.service.ts`, `side-effect-guard.ts` |
| Proposal supervision allows the role strings `OWNER`, `ADMIN`, and `ADVISOR`. `TenantMemberRole` is `OWNER`, `ADMIN`, `TECH`, `SALES`. `ADVISOR` is not a member role, so only `OWNER` and `ADMIN` pass that check. MCP itself allows `OWNER`, `ADMIN`, and `SALES`. | `agent-proposal.authorization.ts`, `agent-action-log.authorization.ts`, `mcp.authorization.ts` |
| Customer, vehicle, and workshop-order deletes are not MCP tools. A missing or invalid branding `Idempotency-Key` is `422` with code `BRAND_IDEMPOTENCY_KEY_INVALID`, and the filter drops that code today. | `MCP_NEVER_EXPOSED_ACTIONS`, `document-branding-extraction.service.ts` |
| `Vehicle` already has `vin`, `plate`, `typenschein_no`, `registration_certificate_no`, `first_registration_date`, `co2_wltp_g_km`, `co2_nedc_g_km`, `hsn`, and `tsn`. It has no Nationalcode column. CO₂ must be an integer from 0 through 600. First registration must be a real `YYYY-MM-DD` and not after today in `Europe/Vienna`. | `schema.prisma`, `vehicle-regulatory.validation.ts` |
| The intake dialog searches VIN, plate, and customer, then either selects a vehicle or calls register. Workshop routes do not check `OWNER` / `ADMIN` / `TECH` / `SALES` today. | `WorkshopOrderIntakeDialog.tsx`, `workshop.controller.ts` |
| AUT-395 is the live-apply gate for the Jev decision adapter. It is not an approval to send a registration document to a processor. | `decision-env.ts`, `docs/internal/02-Feature-Specs/Platform/decision-adapter.md` |

`register` today can change `customer_id` on a VIN match. This feature must not do that unless the person submits the ownership correction below.

Do not import `SiteContextService` from `apps/core-api/src/common/services/site-context.service.ts`. Workshop intake uses the class in `apps/core-api/src/site/site-context.service.ts`.

---

## Decisions

No separate ADR. Tenancy, the stock ledger, and fiscal documents stay as they are. The letterhead ADR stays limited to letterheads.

1. Registration extraction has its own provider symbol, prompt version `registration-document-v1`, storage prefix, and retention. It must not call `buildDocumentBrandingExtractionPrompt`, `DOCUMENT_BRAND_EXTRACTION_PROVIDER`, or the letterhead asset tables.
2. The production binding is a disabled provider. Tests bind a fake provider that returns rows from the fixture file. Neither binding opens a network connection.
3. A live registration processor is a separate prerequisite: a named processor, a signed data-processing agreement, and a written data-residency decision. AUT-395 does not satisfy that. This spec does not open a HUMAN issue and does not treat any vendor as approved. Until that prerequisite exists, the disabled provider stays bound.
4. Nationalcode is not a VIN, not `typenschein_no`, not German ZB I field 2.1/2.2, and not `hsn`/`tsn`. Valuation and Eurotax or Schwacke mapping belong to AUT-527.
5. Agents use the existing `AgentProposal` queue. The action is `registration_intake.apply`. It does not end in `.delete`, so the hard floor does not force `HUMAN_ONLY`. The platform seed is `PROPOSE` and disabled. `HUMAN_ONLY` is refused and is not queued. A person confirms on the workshop route, or an `OWNER` or `ADMIN` applies a `PROPOSE` row.
6. The upload stores `site_id` from `SiteContextService.getSiteId()` at that moment. Nothing copies a later active site onto the intake. Customer and vehicle writes are tenant-wide and still require the caller's active site to be the captured site, otherwise the intake is not found. The workshop order is a second request after that commit. If the active site then differs from the captured site, that second request returns the existing `422` from `resolveCreateSiteId` and does not create the order on the new site.
7. `buildExecutionContext` takes no arguments today (`McpWriteExecution` and `PendingActionExecutor`). S7 changes both signatures to `(input: unknown)` and threads the tool or proposal payload through `mcp-write-pipeline.service.ts`, `mcp-tool-handler.service.ts`, `agent-proposal-submission.service.ts`, and `agent-proposal-decision.service.ts`. The stored intake site is read from `intake_id` inside that payload. The site check does not live only inside `execute`, because `assertActiveSiteUnchanged` calls `buildExecutionContext` before `execute`.
8. Page bytes are never deleted inside `claimAndExecute`. That method runs `executor.execute` in its claim transaction with `DryRunStorage.run({ isDryRun: false, tx })` and has no post-commit hook. Apply inserts one `RegistrationIntakeBytePurge` row in that same transaction. S1 defines that table. S2's minute cron deletes the bytes after the transaction commits and sets `processed_at`.

---

## Scope

In scope: one Austrian Zulassungsschein (Vorderseite and optional Rückseite), evidenced fields including make, model, and year, local matching, human confirmation, ownership correction as an explicit second choice, and the error contract in the fixture file.

Out of scope:

- Authority lookups, FinanzOnline, and any register scrape.
- Changing `customer_id` because the holder text differs, without the correction request.
- Eurotax, Schwacke, or any catalog price. AUT-527.
- Reusing the letterhead prompt or sending registration bytes to Jev, OpenRouter, or any other unapproved processor.
- German ZB I as a supported document.
- Editing invoices, stock, or NoVA.
- Changing `executeCreateWorkshopOrder` to join an outer transaction.

---

## Document and fields

### Files

| Rule | Value |
|---|---|
| Count | 1 or 2 files per intake. `FilesInterceptor` already turns multer `LIMIT_FILE_COUNT` and `LIMIT_UNEXPECTED_FILE` into `BadRequestException` (400). `RegistrationIntakeUploadInterceptor` is registered before it and maps that exception to `REGISTRATION_INTAKE_TOO_MANY_FILES`. The generic multer text is not returned |
| Types | `image/jpeg`, `image/png`, `application/pdf`, detected from bytes. Anything else is `400` `REGISTRATION_INTAKE_UNSUPPORTED_FILE` |
| Size | 10 MiB (10 × 1024 × 1024) per file. `FilesInterceptor` already turns multer `LIMIT_FILE_SIZE` into `PayloadTooLargeException` (413). The upload interceptor maps that exception to `REGISTRATION_INTAKE_FILE_TOO_LARGE`. `GlobalExceptionFilter` writes the body. `HttpStatus[413]` is `PAYLOAD_TOO_LARGE`, and that is the REST `error` value |
| PDF | Pages 1 and 2 are read. Page 1 is the front, page 2 is the back. Further pages set provider warning `EXTRA_PAGES_IGNORED` and are not read |
| Image | One side per file. The client labels `FRONT` or `BACK` |
| Reject | Empty file, encrypted PDF, or a PDF with no readable page: provider warning `ILLEGIBLE` after the row exists, or `400` `REGISTRATION_INTAKE_UNSUPPORTED_FILE` when the bytes are not a JPEG, PNG, or PDF |

A JPEG starts with `FF D8 FF`. A PNG starts with the eight-byte PNG signature. A PDF starts with `%PDF-`.

### Field dictionary

Each extracted field is `{ raw, normalized, source, uncertainty }`. `source` is null or `{ page, region }` with `page` starting at 1 and `region` in unit intervals: `x` and `y` in `[0, 1]`, `width` and `height` in `(0, 1]`, and `x + width <= 1`, `y + height <= 1`. `uncertainty` is null only when the side that carries the field was not uploaded. Otherwise it is a number from 0 through 1. A field is low confidence when `uncertainty` is greater than `0.34`, when `normalized` is null and the absence is not `CONFIDENT`, or when the value fails the check in the table.

When the same field is present on both sides, the lower `uncertainty` wins. If the uncertainties are equal, the front wins. The other value is stored as `alternate`. If the two normalized values differ, the server case is `FIELD_SIDE_CONFLICT`, `uncertainty` becomes 1, and apply cannot treat the field as document-confirmed.

| Field | Document label | Normalized value | Written to | Not written to |
|---|---|---|---|---|
| `vin` | `(E)` FIN | `normalizeVehicleIdentityValueOrNull`. Must be 17 characters from `A-Z` and `0-9` excluding `I`, `O`, and `Q`. A failing value forces `uncertainty` to 1 and server case `INVALID_VIN` | `Vehicle.vin` on create, or the match key on an existing vehicle | `national_code`, `typenschein_no`, `hsn`, `tsn` |
| `plate` | `(A)` Kennzeichen | Same trim-and-uppercase helper. Spaces stay. `W SYNTH 1` does not match `WSYNTH1` | `Vehicle.plate` | |
| `holder` | `(C.1.2)` plus `(C.1.1)`, or one line `pilot customer` | `{ firstName, lastName }` after trim. The fixture line `pilot customer` becomes first `pilot` and last `customer` | New or chosen `Customer.first_name` / `last_name` | Address, phone, and email. The document has no email, so matching does not use email |
| `nationalcode` | Printed label `Nationalcode` | NFC, trim, remove internal spaces, uppercase, then `^[A-Z0-9]{2,16}$` | `Vehicle.national_code` | VIN, Typenschein, HSN, TSN, `identity_keys` |
| `firstRegistration` | `(B)` | `YYYY-MM-DD` via `assertVehicleRegulatoryFields` | `Vehicle.first_registration_date` | |
| `co2` | `(V.7)` | Integer 0 through 600. `cycle` is `WLTP` or `NEDC` from the printed unit. A missing unit leaves the value unstored and adds server case `CO2_CYCLE_UNKNOWN` | `co2_wltp_g_km` or `co2_nedc_g_km` | The other CO₂ column |
| `make` | `(D.1)` | Trimmed display string, 1 to 80 characters | `Vehicle.make` on create only | An existing vehicle's make |
| `model` | `(D.3)` | Trimmed display string, 1 to 80 characters | `Vehicle.model` on create only | An existing vehicle's model |
| `year` | Calendar year of `(B)` | Integer from 1900 through the current Vienna year, taken from `firstRegistration` when that date is present | `Vehicle.year` on create only | An existing vehicle's year |

Create is impossible without make, model, and year because those columns are non-null. On create, the apply body must include all three. When the evidence for one of them is present and not low confidence, the body value must equal the normalized evidence. When the evidence is missing or low confidence, the body value is required human input, stored with `source: "HUMAN"`, and the document value is not copied. A create that still lacks one of the three after that check is `422` `REGISTRATION_INTAKE_VEHICLE_IDENTITY_INCOMPLETE`.

On an existing vehicle, make, model, and year are never written. `national_code`, `first_registration_date`, and the CO₂ column for the confirmed cycle (`co2_wltp_g_km` or `co2_nedc_g_km`) are written only when the stored value is null. A stored value that differs from the confirmed evidence adds `NATIONALCODE_CONFLICT`, `FIRST_REGISTRATION_CONFLICT`, or `CO2_CONFLICT`. Apply then returns `409` `REGISTRATION_INTAKE_FIELD_CONFLICT` and writes nothing, including plate. When those three columns are null or equal to the confirmed values, a successful apply may still change the plate, and that change spreads `VEHICLE_IDENTITY_RESET`. VIN is the match key and is not updated. A retry after `FAILED` uses a new `Idempotency-Key`. The same key replays the `FAILED` row and does not call the provider again.

If the Nationalcode candidate equals the normalized VIN, or is 17 characters, the normalizer forces `uncertainty` to 1 and the server case is `NATIONALCODE_LOOKS_LIKE_VIN`. The column stays null. That case is not a provider warning.

A German heading `Zulassungsbescheinigung Teil I` sets provider `documentKind` to `DE_ZB_I` and provider warning `WRONG_DOCUMENT`. Field 2.1/2.2 is not a Nationalcode and is not `typenschein_no`.

`documentKind` `AT_ZULASSUNGSSCHEIN` is the only kind that can be applied.

### Review cases

Provider warnings describe the file. Server cases describe the tenant. The fixture keeps them in different objects. More than one server case can be present. Apply does not pick among them.

| Server case | When |
|---|---|
| `EXISTING_CUSTOMER` | Exactly one tenant customer matches the normalized first and last name |
| `EXISTING_VEHICLE` | Exactly one tenant vehicle has the normalized VIN, or, when VIN is confidently absent, exactly one vehicle has the normalized plate |
| `DUPLICATE_CUSTOMERS` | More than one customer matches the name |
| `DUPLICATE_VEHICLES` | More than one vehicle matches the plate or VIN predicate |
| `OWNERSHIP_CONFLICT` | The matched vehicle has a `customer_id` and it is not the chosen customer |
| `CONFLICTING_VIN` | A selected vehicle id was sent and its stored VIN differs from the document VIN |
| `MISSING_NATIONALCODE` | Nationalcode absence is `CONFIDENT` |
| `LOW_CONFIDENCE` | Any of VIN, plate, or holder is low confidence, or a present Nationalcode is low confidence |
| `INVALID_VIN` | The VIN fails the 17-character check |
| `FIELD_SIDE_CONFLICT` | Front and back normalized values differ |
| `CO2_CYCLE_UNKNOWN` | V.7 has no WLTP or NEDC unit |
| `NATIONALCODE_CONFLICT` | The matched vehicle's `national_code` is not null and differs from the confirmed code |
| `FIRST_REGISTRATION_CONFLICT` | The matched vehicle's `first_registration_date` is not null and differs from the confirmed date |
| `CO2_CONFLICT` | The confirmed cycle's CO₂ column is not null and differs from the confirmed value |
| `BACK_NOT_SUPPLIED` | Also a provider warning. CO₂ was not on an uploaded side. It does not block apply |

`REGISTRATION_INTAKE_FIELD_CONFLICT` is a hard stop. There is no override and no confirmation that overwrites a stored Nationalcode, first registration, or CO₂ value. The person edits the vehicle outside this intake, then applies again. The review screen lists the case names, shows the `409` message, and does not render an apply button. The fixture key is `existing-vehicle-field-conflict`.

Provider warnings are only `WRONG_DOCUMENT`, `ILLEGIBLE`, `EXTRA_PAGES_IGNORED`, and `BACK_NOT_SUPPLIED`.

Matching uses two queries, not one query per field.

- Customers: `findMany` for the tenant, `take: 25`, `first_name` and `last_name` each `equals` the trimmed evidence with `mode: 'insensitive'`. No email predicate.
- Vehicles: `findMany` for the tenant, `take: 25`. VIN uses `equals` the normalized VIN and can use `vehicles_tenant_id_vin_normalized_key`. Plate uses `equals` the normalized plate with `mode: 'insensitive'`, so `w synth 1` matches `W SYNTH 1`. Plate is not unique and has no case-folding index today. The `mode: 'insensitive'` plate predicate may scan; the `take: 25` cap is the bound. S4 adds a `lower(plate)` expression index only if a query plan shows a sequential scan on a tenant that has more plate rows than the cap can explain. Internal spaces are still significant.
- A 25-row cap adds `DUPLICATE_CUSTOMERS` or `DUPLICATE_VEHICLES`.

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
    warnings: Array<
      'WRONG_DOCUMENT' | 'ILLEGIBLE' | 'EXTRA_PAGES_IGNORED' | 'BACK_NOT_SUPPLIED'
    >;
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
  alternate?: RegistrationFieldEvidence;
}
```

The disabled provider's `isAvailable()` is false. `extract` rejects with `ServiceUnavailableException` whose message is `REGISTRATION_EXTRACTION_UNAVAILABLE: Registration document extraction is not currently available.` and whose body code is `REGISTRATION_EXTRACTION_UNAVAILABLE`. It performs no I/O. Create calls `isAvailable()` only when the idempotency key has no finished row. A new request then returns `503` before any insert, so a disabled provider never stores a new row or page bytes. A finished key still replays its stored `201`. An available provider whose `extract` then fails is the `201` `FAILED` path below.

The fake provider returns the `extractions` object for a fixture id. Unknown bytes return the `illegible` extraction. The prompt file is new and contains only the field dictionary above.

Candidate snapshot stored on the intake, produced by the match queries:

```typescript
export interface RegistrationMatchSnapshot {
  customers: { id: string; firstName: string; lastName: string }[];
  vehicles: {
    id: string;
    vin: string | null;
    plate: string | null;
    customerId: string | null;
  }[];
  cases: string[];
}
```

Apply body. Critical identity values must equal the stored normalized evidence. `nationalcode` must be the normalized code, or `null` when the case is `MISSING_NATIONALCODE`. Omitting a critical key is a mismatch. `make`, `model`, and `year` are required when `vehicleId` is absent.

```typescript
export interface ApplyRegistrationIntake {
  vin: string | null;
  plate: string;
  holder: { firstName: string; lastName: string };
  nationalcode: string | null;
  firstRegistration: string | null;
  co2: { value: number; cycle: 'WLTP' | 'NEDC' } | null;
  make?: string;
  model?: string;
  year?: number;
  customerId?: string;
  vehicleId?: string;
  ownershipCorrection?: {
    expectedCustomerId: string | null;
    nextCustomerId: string;
  };
}
```

The REST apply id is the path parameter only. A body `intakeId` is rejected with `400` `REGISTRATION_INTAKE_ID_MISMATCH: The intake id is taken from the path.` The MCP tool uses `intake_id` in snake_case, the same casing as `customer_id` and `vehicle_id` on the existing write tools. `ownershipCorrection` is the only way `Vehicle.customer_id` changes. Without it, an `OWNERSHIP_CONFLICT` apply returns the ownership conflict response and writes nothing.

The workshop order is not part of this body. After apply commits, `POST /api/workshop/registration-intakes/:id/order` calls `executeCreateWorkshopOrder` with the committed ids and `expectedSiteId` set to the intake's stored `site_id`. Odometer and fuel follow `CreateWorkshopOrderDto`. That call is outside the apply transaction, so the new rows are visible.

---

## HTTP contract

Prefix `/api`. Tenant id comes from the authenticated context. Every route calls `getSiteId()` before it reads the intake, which checks the active membership. The intake is then loaded with `tenant_id` and `site_id` equal to that active site. A row that exists only at another site is `404` `Registration intake ${id} not found` for get, apply, abort, delete, and the order follow-up. The captured `site_id` is not updated.

Create also requires `Idempotency-Key`. The unique key is `(tenant_id, captured_by_user_id, site_id, idempotency_key)`. A replay by another user or another site does not return the first user's intake. The request hash covers the file bytes, the side labels, the user id, and the site id.

The key is 1 to 128 characters matching `^[\x21-\x7e]+$`, the same shape as the letterhead key. Missing, empty, too long, or not matching that pattern is `422` `REGISTRATION_INTAKE_IDEMPOTENCY_KEY_INVALID: A valid Idempotency-Key header is required.`

Roles on these routes are `OWNER`, `ADMIN`, and `SALES`. `TECH` is `403` `Registration intake is limited to OWNER, ADMIN, and SALES.` Proposal approve stays on the existing supervisor check: the allowed strings are `OWNER`, `ADMIN`, and `ADVISOR`, and because `ADVISOR` is not a `TenantMemberRole`, only `OWNER` and `ADMIN` can approve. `SALES` may call the MCP tool and the workshop routes. `SALES` may not approve the proposal.

| Method | Route | Result |
|---|---|---|
| `POST` | `/workshop/registration-intakes` | Multipart files. `201` with state `AWAITING_REVIEW` or `FAILED`, or `503` when the provider is disabled. See create below |
| `GET` | `/workshop/registration-intakes/:id` | `200` evidence, server cases, and candidates. No file bytes |
| `POST` | `/workshop/registration-intakes/:id/apply` | `200` when the confirmation matches and the customer and vehicle commit. No workshop order |
| `POST` | `/workshop/registration-intakes/:id/order` | `200` with the workshop order id. Uses `executeCreateWorkshopOrder` after the identity commit |
| `POST` | `/workshop/registration-intakes/:id/abort` | `200` `{ state: "ABORTED", bytesDeleted: true }` |
| `DELETE` | `/workshop/registration-intakes/:id` | `204` before apply. After apply, the applied-delete response |

### Create, provider failure, and replay

Create is synchronous. It still uses states `UPLOADED`, `QUEUED`, and `RUNNING` inside the request so a concurrent caller can observe them.

1. Validate the key, role, active site, file count, size, and magic bytes. Failures return the fixture responses and write no row and no bytes.
2. Look up `(tenant_id, captured_by_user_id, site_id, idempotency_key)` before `isAvailable()`. A finished row with the same hash returns that `201` (`AWAITING_REVIEW` or `FAILED`) and does not call the provider. That replay still returns the stored row when the provider was disabled after the first success.
3. If no row exists and `provider.isAvailable()` is false, return `503` `REGISTRATION_EXTRACTION_UNAVAILABLE` and write no row and no bytes. The same key can be used after the provider is enabled, because nothing was stored. `GlobalExceptionFilter.captureSentryIfInternal` records every status of 500 or above, so this expected `503` is sent to Sentry, the same way `BRAND_EXTRACTION_UNAVAILABLE` is. That capture is accepted. The code stays client-safe, so the body is not replaced with `Something went wrong`.
4. Insert the row and store the bytes.
5. Set `RUNNING` and call `extract` once.
6. On success, set `AWAITING_REVIEW` and return `201`.
7. Any other provider failure sets `FAILED`, keeps that row, and returns `201` with `failureCode` `REGISTRATION_INTAKE_EXTRACT_FAILED`. Replay of that key returns the same `201` and does not call the provider again. A new attempt needs a new `Idempotency-Key`.

Same key and same hash once the first request finished: `201` and the same id. Provider call count stays 1.

Same key and a different hash: idempotency conflict.

Same key while the first request is still `UPLOADED`, `QUEUED`, or `RUNNING`: `409` `REGISTRATION_INTAKE_IN_PROGRESS: An intake with this idempotency key is still running.` The second request does not start another provider call.

### Apply and the workshop order

Apply accepts only `AWAITING_REVIEW`. It commits the customer and vehicle, sets `APPLIED`, and returns `workshopOrderId: null`. It does not call `executeCreateWorkshopOrder`.

A lost `updateMany` returns `409` `REGISTRATION_INTAKE_STATE_CHANGED: The intake changed; please reload.`

The order route accepts only `APPLIED` with `applied_workshop_order_id` null. It calls `executeCreateWorkshopOrder` on the root client, with `expectedSiteId` equal to the stored site. Success stores `applied_workshop_order_id`. A later call with the same order already stored returns `200` and that id.

If the vehicle already has a live order, `assertNoLiveOrderForVehicle` throws the existing `409` `VEHICLE_HAS_ACTIVE_ORDER` with `orderId` and `orderNumber`. The filter already forwards those two fields. The intake does not store that order id. The person opens the named order. A retry of this route does not attach it.

If the active site differs from the stored site, `resolveCreateSiteId` returns `422` `Select the site where this action was simulated before applying it`. The intake stays `APPLIED`, the order id stays null, and the document is not moved. The person switches back to the captured site and retries this route.

If order creation throws after the identity commit, the intake stays `APPLIED`, the order id stays null, and the response is the error from the existing helper. Replay of apply returns the applied identity body and does not create a second customer or vehicle. Retry of the order route is the recovery.

### Abort, delete, and bytes

Abort is allowed from `UPLOADED`, `QUEUED`, `RUNNING`, `AWAITING_REVIEW`, `FAILED`, and `ABORTED`. A repeat abort of an already `ABORTED` row returns `200` `{ state: "ABORTED", bytesDeleted: true }` and does not call the provider. Abort of `APPLIED` is `409` `REGISTRATION_INTAKE_APPLIED: An applied intake cannot be deleted.`

Abort and delete use the same order. Delete the page objects first. Only then commit the row change: abort sets `ABORTED`, delete removes the row and returns `204`. If the object delete fails, the row is unchanged and the response is `503` `REGISTRATION_INTAKE_BYTES_REMAIN: The file could not be deleted.` A retry sees the original state and tries the object delete again. If the object delete succeeds and the row commit then fails, a retry sees no objects, completes the row change, and returns the success body. That code is client-safe so production does not replace the `503` with `Something went wrong (ref: ...)`.

Apply and proposal approval do not delete objects inside their database transaction. They insert one `RegistrationIntakeBytePurge` row in that transaction, or leave the existing row when `intake_id` already has one. `DryRunStorage.isDryRun()` skips the insert, and a rolled-back preview therefore leaves no outbox row and does not touch object storage. The `propose` result has `bytesDeleted: false` for that reason. The cron job below deletes the objects after commit, then sets `processed_at`. It does not delete the outbox row. `POST /api/workshop/registration-intakes/:id/purge-bytes` runs that step once for one intake. A failed purge leaves `processed_at` null and returns `503` `REGISTRATION_INTAKE_BYTES_REMAIN`.

`claimAndExecute` runs `execute` inside the claim transaction. If `execute` throws, that transaction rolls back, so the intake state is unchanged and no outbox row remains. The catch then calls `markExecutionFailed`, which sets the proposal to `FAILED` while it is still `PENDING`. That `FAILED` status is final. Approving the same proposal does not run `execute` again. The HTTP response is still the error from `execute`. The messages `Vehicle was created by another intake; please retry`, `Vehicle VIN or plate changed while registering intake; please retry`, `Vehicle holder changed while confirming intake; please retry`, and `REGISTRATION_INTAKE_STATE_CHANGED: The intake changed; please reload.` stay unchanged. On the REST apply route they mean the person retries that route. On the approve route they are the proposal's terminal reason, and recovery is a new `propose_registration_intake` or the REST route. Bytes stay until abort, the purge job, or expiry.

### REST and MCP

REST JSON is what `GlobalExceptionFilter` writes: `statusCode`, `message`, `error`, and `code` only when the code is listed in `CLIENT_SAFE_HTTP_ERROR_CODES`. A status of 500 or above also includes `requestId` when the request has one. S2 adds every registration code in the fixture file to that set, including the codes S5 throws. S5 does not edit the allowlist. `503` is not in the filter's status-name switch, so `error` is `SERVICE_UNAVAILABLE` (`HttpStatus[503]`).

`FilesInterceptor` converts multer errors before the controller runs. `LIMIT_FILE_SIZE` becomes `PayloadTooLargeException` (413). `LIMIT_FILE_COUNT` and `LIMIT_UNEXPECTED_FILE` become `BadRequestException` (400). A scoped exception filter cannot replace that body, so S2 does not add one. `RegistrationIntakeUploadInterceptor` is listed before `FilesInterceptor` so it wraps that call. It maps the thrown `HttpException` by status and by the multer code (`LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_UNEXPECTED_FILE`) and rethrows `HttpException` with `{ message, code }`. It does not parse a raw multer error. The global filter then writes `statusCode`, `message`, `error`, and `code`. Both statuses are below 500, so those two bodies have no `requestId`. Any later 5xx on the route still goes through the global filter and includes `requestId`.

MCP does not return `statusCode`. A thrown `HttpException` becomes a tool result with `isError: true` and text equal to `exception.message`. That is why each new message starts with its code. Policy refusal stays the existing message that starts with `not_permitted`. `ZodError` stays a schema failure with tier `NOT_EVALUATED` and log status `FAILED`.

Expected bodies are the `responses` object in the fixture file. Reused strings, copied from current code, have no `code` property:

- `Vehicle was created by another intake; please retry`
- `Vehicle VIN or plate changed while registering intake; please retry`
- `Vehicle holder changed while confirming intake; please retry` is new, and it also has no `code`, matching the VIN race shape
- `Select the site where this action was simulated before applying it` (`422`, order follow-up and proposal approve after S7)
- `The active site changed while the pending action was simulated` (`422` from `submitPendingAction` after S7 includes this action; `409` from `McpWritePipeline.assertActiveSiteUnchanged` when the two `buildExecutionContext` site ids differ)
- The active-site message quoted above, still without `code`
- `Unsupported action type for automatic execution: registration_intake.apply` until S7 adds the `resolve` case (`400`)
- `HUMAN_ONLY proposals must be performed manually` (`422`)
- `Supervision access is restricted to OWNER, ADMIN, and ADVISOR roles only.` (`403`)

`not_permitted` on MCP is `403` on the HTTP exception and is not a REST `code` field. The agent log row is `tier: HUMAN_ONLY`, `status: REFUSED`, and no `AgentProposal` row is inserted.

### Parallel create, replay, abort, ownership

| Situation | Response |
|---|---|
| Two finished creates, one user, one site, one key, one hash | One row. Second response is the first `201`. Provider call count is 1 |
| Same key while the first is `RUNNING` | In-progress `409` |
| Same key, different hash, same user and site | Idempotency conflict |
| Same key, different user or site | A different unique key. No replay of the other intake |
| Two applies create the same new VIN | One insert wins. The other is `409` `Vehicle was created by another intake; please retry` |
| Plate change on an existing vehicle | The `updateMany` guard includes the current plate, VIN, `identity_resolution_generation`, and `identity_resolution_token`. A changed plate also writes `VEHICLE_IDENTITY_RESET` and `identity_resolution_token: null`. Count `0` is `409` `Vehicle VIN or plate changed while registering intake; please retry` |
| Apply after abort | State-changed conflict. No customer and no vehicle |
| Abort while `RUNNING`, including a second abort | Objects are deleted first, then the row becomes `ABORTED`. A failed object delete leaves the row unchanged and returns `503`. A late provider result with the old lease token does not write |
| Delete before apply | `204`, bytes deleted |
| Delete or abort after apply | Applied-delete response. Customer, vehicle, and order stay |
| Apply on `DE_ZB_I` or illegible evidence | Wrong-document or illegible response. No writes |
| Apply when VIN, plate, or holder is low confidence, or a present Nationalcode is low confidence, or the VIN is invalid, or the Nationalcode looks like a VIN | The matching fixture response. No writes, including no proposal that would create those rows |
| Confirmed VIN differs from evidence, or selected vehicle VIN differs | Confirmation mismatch, or conflicting-VIN response |
| Several customers or plate vehicles, including a plate that differs only by case | Ambiguous-match response. The candidate ids are on the intake. None is selected |
| Missing Nationalcode, and the body sends `nationalcode: null` | Allowed. VIN is not copied into `national_code` |
| Missing Nationalcode, and the body sends the VIN or a Typenschein value as `nationalcode` | Confirmation mismatch |
| Vehicle customer differs and `ownershipCorrection` is absent | Ownership conflict. `customer_id` unchanged |
| `ownershipCorrection.expectedCustomerId` matches, and `nextCustomerId` is the confirmed holder | `customer_id` updates in the same `updateMany` that checks VIN, plate, identity-resolution generation and token, and the expected customer. Count `0` returns `Vehicle holder changed while confirming intake; please retry` |
| Order route after a site switch | `422` `Select the site where this action was simulated before applying it`. Identity stays applied |
| Order route throws | Identity stays applied, `workshopOrderId` stays null, body is `orderFailed` in the fixture |
| Agent tool, tier `PROPOSE`, evidence is confirmable | `{ status: "needs_approval", pending_action_id }` and no customer, vehicle, or order until `POST /api/agent-proposals/:id/apply` |
| Agent tool, tier `HUMAN_ONLY`, disabled rule, or no platform rule | `not_permitted` text, log `REFUSED`, no proposal |
| Supervisor applies a `HUMAN_ONLY` proposal | Existing `422` `HUMAN_ONLY proposals must be performed manually` |
| MCP preview or `submitPendingAction` | Rollback of the database work. Page bytes stay. `DryRunStorage.isDryRun()` skips object deletes |

The MCP tool name is `propose_registration_intake`. Its input carries `intake_id` plus the apply body fields. Its policy action is `registration_intake.apply`. There is no MCP tool for upload bytes, abort, delete, or the order follow-up. `customer.delete`, `vehicle.delete`, and `workshop_order.delete` stay unregistered.

S7 `buildExecutionContext(input)` reads `intake_id` from `input`, loads that intake, and returns `{ site_id }` from the row after checking that the session site equals it. A mismatch throws `404` `Registration intake ${id} not found`. The write pipeline passes `call.input` into both `buildExecutionContext` calls. A session switch between them still returns the same stored site, so `assertActiveSiteUnchanged` does not throw its `409` unless the stored site itself changes. The session switch is the `404` above, from the second call. S7 adds this action to `submitPendingAction`, passes `dto.payload_json` into `buildExecutionContext`, and keeps the existing `422` `The active site changed while the pending action was simulated` when `siteContext.getSiteId()` changes during that dry run. `claimAndExecute` passes `proposal.payload_json` and then `{ site_id }` from the preview into `execute`. `assertSiteMatchesSimulation` throws the existing `422` `Select the site where this action was simulated before applying it` when the session site differs from `preview_json.execution_context.site_id`.

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
| `captured_by_user_id` | UUID | no | FK `User`, `onDelete: Restrict`. Part of the idempotency unique key |
| `idempotency_key` | varchar(128) | no | Unique with tenant, user, and site |
| `request_hash` | char(64) | no | SHA-256 of bytes, side labels, user id, and site id |
| `state` | enum | no | See states |
| `document_kind` | varchar(32) | yes | |
| `failure_code` | varchar(64) | yes | Set when state is `FAILED` |
| `evidence` | Json | yes | Field evidence. No image bytes. After apply, `holder.raw` and any address text are null. Normalized holder names remain |
| `match_snapshot` | Json | yes | Candidates and server cases |
| `lease_token` | varchar(64) | yes | Cleared when the job ends |
| `provider_id` | varchar(64) | yes | `disabled` or `fake` until a live provider exists |
| `prompt_version` | varchar(64) | yes | `registration-document-v1` |
| `applied_customer_id` | UUID | yes | Single-column FK to `Customer.id`, `onDelete: SetNull` |
| `applied_vehicle_id` | UUID | yes | Single-column FK to `Vehicle.id`, `onDelete: SetNull` |
| `applied_workshop_order_id` | UUID | yes | Single-column FK to `WorkshopOrder.id`, `onDelete: SetNull` |
| `expires_at` | timestamptz | yes | 30 days after create while unapplied |
| `createdAt` / `updatedAt` | timestamptz | no | |

Unique `(tenant_id, id)` and `(tenant_id, captured_by_user_id, site_id, idempotency_key)`. Index `(tenant_id, site_id, createdAt)` and `(expires_at)`.

The three `applied_*` foreign keys reference `id` alone, the same shape as `Vehicle.customer_id`. They are not composite `(tenant_id, id)` keys. `site_id` stays the composite `(tenant_id, site_id)` reference and uses `Restrict`, not `SetNull`. A composite `ON DELETE SET NULL` would also null `tenant_id`, which is not nullable, and the customer or vehicle delete would fail. Prisma `onDelete: SetNull` emits `ON DELETE SET NULL` for every column in the key, so S1 does not use a column-list `SET NULL (col)` here.

`RegistrationIntakeBytePurge` (`registration_intake_byte_purges`) is the apply outbox. S1 creates it in the same migration as `registration_document_intakes`, after that table.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | |
| `tenant_id` | UUID | no | FK tenant, `onDelete: Restrict` |
| `intake_id` | UUID | no | Single-column FK to `registration_document_intakes.id`, `onDelete: Restrict` |
| `object_prefix` | varchar(256) | no | `registration-intakes/{tenantId}/{intakeId}/` |
| `attempts` | int | no | Starts at 0. Each failed object delete adds 1 |
| `last_error` | varchar(512) | yes | Last object-delete failure. Null after success |
| `created_at` | timestamptz | no | |
| `processed_at` | timestamptz | yes | Set after the objects are deleted. The row stays |

Unique `(tenant_id, id)` and unique `intake_id`, so a replayed apply does not insert a second row. Partial index `registration_intake_byte_purges_pending_idx` on `created_at` where `processed_at` is null. The job reads that index.

Two Cloud Run instances can run the cron at once. The claim is a conditional `updateMany`, the same shape as `NotificationOutboxRecoveryService.wakeDueRows`. The worker reads a pending id, then updates that row only where `processed_at` is null and `attempts` is still the value it read, and increments `attempts`. `count === 1` means this instance owns the row. `count === 0` means another instance claimed it, and this instance skips it. Object delete is idempotent. The claim is what keeps `attempts` and `last_error` from being written twice. Success sets `processed_at` with a second `updateMany` that still requires `processed_at` null. Failure writes `last_error` under that same condition and leaves `processed_at` null.

Page bytes live in object storage at `registration-intakes/{tenantId}/{intakeId}/page-{n}`. They are not a `DocumentBrandAsset`. Until the job runs, an applied intake's pages are still stored. S2 schedules `RegistrationIntakeBytePurgeService` with `@Cron(CronExpression.EVERY_MINUTE)`, name `registration-intake-byte-purge`, in the same shape as `DocumentBrandingUploadRecoveryService.recoverAndClean`. The wait is at most one minute plus that pass. The manual purge route does not wait for the cron.

### Modified Tables

| Table | Change | Migration Required? |
|---|---|---|
| `vehicles` | Add `national_code` and the non-unique index | Yes |
| `customers`, `workshop_orders` | No column changes. Apply may insert a customer. The order route may insert an order through the existing helper | No |
| `agent_policy_rules` | S7 inserts one platform row | Yes, in S7 |

### Deletion Policy Impact

Add these rules to `docs/deletion-policy.md` in the schema slice:

| Entity | Delete | Rule |
|---|---|---|
| `RegistrationDocumentIntake` | Before `APPLIED` | Hard delete the row and the page objects from `UPLOADED`, `QUEUED`, `RUNNING`, `FAILED`, `ABORTED`, and `AWAITING_REVIEW` |
| `RegistrationDocumentIntake` | `APPLIED` | Refuse. The row is audit. Page objects are deleted by the outbox job |
| `RegistrationIntakeBytePurge` | With the intake | Keep the row after `processed_at` is set. Tenant purge deletes the tenant object prefix first, then these rows, then the intakes. `onDelete: Restrict` stops an intake delete that still has an outbox row |
| `Customer` | Existing rule | An applied intake does not block `CustomerService.remove`. `onDelete: SetNull` clears `applied_customer_id`. `CustomerService.remove` does not open a transaction today. S5 wraps the evidence update and `deleteMany` in one `$transaction`. That update clears `evidence.holder` and `match_snapshot` so the holder line is erased. It is not a foreign-key guard |
| `Vehicle` | Existing rule | `vehicle.service.ts` has no delete method today. `onDelete: SetNull` clears `applied_vehicle_id`. S5 exports `clearRegistrationEvidenceForVehicle` and tests it. The first vehicle delete endpoint calls it in its transaction |
| `WorkshopOrder` | Existing rule | There is no order-delete route today. `onDelete: SetNull` clears `applied_workshop_order_id` |
| `Vehicle.national_code` | n/a | Follows the vehicle delete rule |

`match_snapshot` is set to null in the apply transaction, after the chosen ids are stored. It does not keep other customers' names on an applied row. The raw holder line is removed from `evidence` in that same transaction. Normalized names stay until the customer delete above clears them.

S2 owns the cleanup job. Its expiry pass deletes unapplied rows whose `expires_at` is past, and their page objects, through the same byte helper as abort. That pass only sees rows that still exist. Applied intake rows are removed only by tenant purge. `SetNull` does not require `registration_document_intakes` to be purged before customers, vehicles, or workshop orders.

Unapplied pages are not outbox rows. A tenant purge that deleted only pending `object_prefix` values would leave `AWAITING_REVIEW` and `FAILED` bytes in the bucket, and the expiry pass would not see them after the intake rows were gone. S2's byte helper therefore deletes the whole prefix `registration-intakes/{tenantId}/`. That covers applied pages named by the outbox and every unapplied page for that tenant. S1 writes this order into `docs/deletion-policy.md`. S2 implements the prefix delete. The operator runs it before the SQL purge. If the prefix delete fails, the SQL purge does not run, and the expiry pass can still delete objects for rows that remain. The generated purge SQL does not touch object storage. After a successful prefix delete, SQL deletes `registration_intake_byte_purges` and then `registration_document_intakes`. S1 still checks the generated purge SQL.

### Tenant restore

The schema slice runs `tools/tenant-restore/generate-tenant-restore-sql.mjs` and `node tools/tenant-restore/verify-table-list.mjs`. Both new tables have `tenant_id`, so the generator includes them. `registration_intake_byte_purges.intake_id` is `Restrict`, so the generated purge deletes the outbox before the intake. Page objects are not in the SQL dump. A restored unapplied intake whose bytes are missing is read as `ABORTED`. A restored outbox row with `processed_at` null is picked up by the next cron pass.

### Real-Time Sync

Do not add `RegistrationDocumentIntake` to `SUPPORTED_ENTITY_TYPES` or `dashboard-entity-map.ts`. Customer, vehicle, and workshop-order writes already emit `CUSTOMER`, `VEHICLE`, and `WORKSHOP_ORDER`.

No inventory ledger change. No invoice and no `lock_date` change.

---

## API Contract Changes

### New Endpoints

Listed in the HTTP contract. Auth is the authenticated tenant user with role `OWNER`, `ADMIN`, or `SALES`, plus `getSiteId()`.

### Modified Endpoints

| Method | Route | Change Description |
|---|---|---|
| `POST` | `/api/workshop/register` | Unchanged. The dialog stops calling it for a document intake and calls apply instead |
| `POST` | `/api/workshop/orders` | Unchanged. The order follow-up calls `executeCreateWorkshopOrder` |
| `POST` | `/api/agent-proposals/:id/apply` | Unchanged route. S7 teaches `assertSiteMatchesSimulation` about `registration_intake.apply` |
| `POST` | `/api/agent-proposals/submit` | Unchanged route. S7 includes this action in the session-site check |

### OpenAPI Regeneration

Owned by S5, after the DTOs exist:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

Both generated files ship in that slice's pull request. S7 regenerates them again if the MCP schemas change the public REST contract. MCP tool schemas are not the OpenAPI file.

---

## UX Compliance

The change is a step inside `WorkshopOrderIntakeDialog`, not a new list page.

### Layout & Actions

- [x] The dialog keeps its current footer actions. No new page header.
- [x] Page-level create and save rules are unchanged because this is not a new page.
- [ ] List-page rules do not apply.
- [x] Review state uses `StatusBadge`.
- [x] Confirmation is an explicit submit. It is not a 750 ms auto-save, because submit creates a customer and maybe a vehicle.

The dialog shows raw and normalized values, the page and region, and the uncertainty. Make, model, and year are visible. Low-confidence critical fields have no save action. Human-typed make, model, and year are available only when the evidence for that field is missing or low confidence, and only for a new vehicle. Wrong document, illegible, duplicate, conflicting VIN, invalid VIN, VIN-shaped Nationalcode, ownership conflict, and `REGISTRATION_INTAKE_FIELD_CONFLICT` each have their own copy. Field conflict has no overwrite control. Ownership changes only through a second control that posts `ownershipCorrection`. Nationalcode is labeled `Nationalcode`, with the existing Typenschein hint left on the Typenschein field. The order step is a separate submit after apply returns.

### Real-Time Sync

- [x] No new dashboard entity.
- [x] Existing customer, vehicle, and workshop-order events stay as they are.

---

## Component Design

| Component | Location | Purpose |
|---|---|---|
| `WorkshopOrderIntakeDialog` | `apps/core-web/src/components/workshop/WorkshopOrderIntakeDialog.tsx` | Adds the upload step and renders the review cases. It does not decide matches |
| `RegistrationDocumentReview` | `apps/core-web/src/components/workshop/RegistrationDocumentReview.tsx` | Shows evidence and posts apply, the order follow-up, abort, or delete |

Business rules stay in the API. The client displays the server cases and the server error `code` when the filter returns one.

---

## Provider and retention

| Binding | Behavior |
|---|---|
| Production | Disabled provider. A new create checks `isAvailable()` before any insert and returns `503` with no row and no bytes. A finished idempotency key still returns its stored `201`. No network |
| Test | Fake provider. Reads the fixture JSON. No network |
| Live | Not part of any slice. Requires a named processor, a data-processing agreement, and a data-residency decision. AUT-395 does not provide those. No registration image, PDF, or raw holder line is sent to Jev or to an unapproved processor |

Retention: page bytes are deleted on abort, on delete, on the post-commit apply purge, and when an unapplied intake expires at 30 days. The cleanup job is owned by S2. Evidence JSON on an applied row keeps normalized fields and drops `holder.raw` and address text. Letterhead quotas and the branding idempotency index are not reused.

Preview and `submitPendingAction` do not call the extraction provider. The provider runs only from create.

---

## Implementation slices

Each backend area has one owner. Later slices call the earlier slice. They do not reimplement it.

| Slice | Owns | Does not own |
|---|---|---|
| S1 Schema | Prisma models, including `RegistrationIntakeBytePurge` in the same migration after `registration_document_intakes`, `national_code`, `Restrict` on tenant and user, single-column `SetNull` on the three applied foreign keys, `docs/deletion-policy.md`, tenant-restore SQL and the purge order | HTTP, the cron job, provider, policy seed |
| S2 Upload | Create, get, abort, delete, purge-bytes, the `@Cron` job on the S1 outbox, `RegistrationIntakeUploadInterceptor`, byte helper used only by abort, delete, and that job, disabled and fake providers, MIME and size checks, idempotency, and every registration code in `CLIENT_SAFE_HTTP_ERROR_CODES` | Match queries, apply writes, the outbox migration, MCP |
| S3 Evidence | Prompt `registration-document-v1`, normalizer, side-merge rule, lease token | Customer and vehicle writes |
| S4 Match | The two `findMany` queries, case-insensitive plate and name match, server cases | Apply |
| S5 Apply | Exact confirmation, fill-blank rules for Nationalcode, first registration, and CO₂, plate-change `VEHICLE_IDENTITY_RESET`, ownership `updateMany`, stripping `holder.raw` and `match_snapshot`, the outbox insert, `CustomerService.remove` clearing holder evidence before delete, `clearRegistrationEvidenceForVehicle`, the order route that calls `executeCreateWorkshopOrder` after commit, OpenAPI and web types | Editing `executeCreateWorkshopOrder` to take an outer transaction, the error-code allowlist, MCP, object-store deletes |
| S6 UI | The dialog step and `RegistrationDocumentReview` | Any rule that is not already enforced in S5 |
| S7 Agent path | `PendingActionType` and the `resolve` case, which calls the S5 service; changing `buildExecutionContext` to `(input: unknown)` on `PendingActionExecutor` and `McpWriteExecution`, and passing the payload from the write pipeline, the tool handler, `submitPendingAction`, and `claimAndExecute`; platform migration seeding `registration_intake.apply` at `PROPOSE`, `enabled` false, version 1; `MCP_WRITE_POLICY_ACTION_TYPES`; `effectiveMcpWriteTier` clamp from `AUTO` to `PROPOSE` for `propose_registration_intake`; `MCP_WRITE_TOOL_NAMES`, input schema with `intake_id`, descriptions, and factory wiring; `submitPendingAction` session-site check; `assertSiteMatchesSimulation` for this action; passing `{ site_id }` from the payload into `execute` on approve, the same way `workshop_order.create` does | A second proposal table, upload, and object-store deletes |

S2 through S7 are not started by AUT-516. A live provider is not an eighth slice.

The platform row is disabled, so evaluation is `HUMAN_ONLY` with `rule_disabled_fail_closed` until an `OWNER` or `ADMIN` enables it. `assertTierNotLooserThanPlatform` rejects a tenant `AUTO` against the platform `PROPOSE` tier with `422` `AGENT_POLICY_LOOSER_THAN_PLATFORM`. The trigger `agent_policy_tenant_tier_looser_than_platform` returns without checking when the latest platform row has `enabled = false` (`20261003160000_agent_policy_rules`). While this seed stays disabled, a direct database insert of a tenant `AUTO` row is not blocked. The MCP clamp still holds an `AUTO` tool result at `PROPOSE`. After the platform row is enabled, the trigger checks new tenant rows. With no row at all, evaluation stays `unknown_action_fail_closed` and `resolve` stays the existing `400`.

---

## Testing Plan

Implementation tests load [registration-document-intake.fixtures.json](./registration-document-intake.fixtures.json). They do not weaken existing intake assertions.

### Backend

- [ ] Create from `front-clear` plus `back-clear` stores both pages, merges CO₂, and keeps make, model, and year.
- [ ] `wrong-document-zb-i`, `illegible`, `conflicting-vin`, `missing-nationalcode`, `multiple-duplicates`, `low-confidence`, `ownership-conflict`, `nationalcode-looks-like-vin`, `extra-pdf-pages`, and `invalid-vin` produce the fixture extractions and the fixture responses.
- [ ] Parallel create and replay: one row, one provider call; a different hash returns the idempotency conflict; a different user does not see the row; a concurrent `RUNNING` row returns in-progress.
- [ ] A new create while the provider is disabled returns `503` and writes no row and no bytes. Replay of a finished key still returns the stored `201`.
- [ ] Approving a proposal whose `execute` throws `409` marks that proposal `FAILED` once. A second approve does not run `execute`. REST apply of the same `409` can be retried.
- [ ] An existing vehicle with a different Nationalcode, first registration, or CO₂ returns the conflict case and does not overwrite those columns. The fixture document `existing-vehicle-field-conflict` supplies the stored vehicle. A null column is filled.
- [ ] Two cron instances claim one outbox row with the conditional `updateMany`. Only the instance that gets `count === 1` increments `attempts`.
- [ ] Tenant purge deletes `registration-intakes/{tenantId}/` before the SQL purge, including bytes for unapplied intakes. A failed prefix delete skips the SQL purge.
- [ ] The order route returns `409` `VEHICLE_HAS_ACTIVE_ORDER` with `orderId` and `orderNumber` and leaves `applied_workshop_order_id` null.
- [ ] A file over 10 MiB returns `413` with `code` `REGISTRATION_INTAKE_FILE_TOO_LARGE`.
- [ ] Abort and delete remove objects first and commit the row only after that. A repeated abort returns `200`. Delete after apply returns the applied-delete body. A failed object delete leaves the row unchanged and returns `503` with `code` `REGISTRATION_INTAKE_BYTES_REMAIN`.
- [ ] An available provider whose `extract` fails returns `201` `FAILED` with `failureCode` `REGISTRATION_INTAKE_EXTRACT_FAILED` and keeps the row and bytes. Replay of that key does not call the provider again.
- [ ] A dry-run apply leaves the page objects in place.
- [ ] Ownership correction updates `customer_id` only when `expectedCustomerId` matches. A stale holder returns the retry message. Apply without the correction flag does not change `customer_id`.
- [ ] A plate change resets identity resolution and a lost generation guard returns `Vehicle VIN or plate changed while registering intake; please retry`.
- [ ] Low confidence, an invalid VIN, a VIN-shaped Nationalcode, and a mismatched confirmation write neither customer nor vehicle.
- [ ] Create of a vehicle without make, model, and year is `422` `REGISTRATION_INTAKE_VEHICLE_IDENTITY_INCOMPLETE`.
- [ ] The order route after a committed apply calls `executeCreateWorkshopOrder`. A site switch returns the existing `422` and leaves `workshopOrderId` null.
- [ ] `HUMAN_ONLY` does not insert `AgentProposal`. `PROPOSE` returns `needs_approval`. Before the S7 seed, `resolve` returns the existing `400`.
- [ ] A get, abort, or delete with the active site different from `site_id` is `404`.
- [ ] Existing files `workshop-intake.e2e-spec.ts` and `vehicle-identity.service.spec.ts` still pass. They are not proof of this feature.

### Frontend

- [ ] The dialog blocks save on low confidence, requires make, model, and year for a new vehicle, requires a choice when several duplicates are listed, and asks for a separate confirmation before it posts `ownershipCorrection`.

---

## Open Questions

None for this contract. Processor approval, a data-processing agreement, and data residency stay outside this issue. AUT-395 does not close them. Catalog valuation stays on AUT-527.

---

## References

- [registration-document-intake.fixtures.json](./registration-document-intake.fixtures.json)
- `apps/core-api/src/workshop/workshop-intake-vehicle.helpers.ts`
- `apps/core-api/src/workshop/workshop-intake-create.helpers.ts`
- `apps/core-api/src/vehicle/vehicle-identity.service.ts`
- `apps/core-api/src/vehicle/vehicle-identity.util.ts`
- `apps/core-api/src/vehicle/vehicle-regulatory.validation.ts`
- `apps/core-api/src/document-branding/document-branding-extraction.service.ts`
- `apps/core-api/src/document-branding/document-branding-extraction-prompt.ts`
- `apps/core-api/src/site/site-context.service.ts`
- `apps/core-api/src/common/filters/global-exception.filter.ts`
- `apps/core-api/src/common/errors/client-safe-http-error-codes.ts`
- `apps/core-api/src/pending-action-executor/pending-action-executor.service.ts`
- `apps/core-api/src/agent-policy/agent-policy.evaluator.ts`
- `apps/core-api/src/agent-policy/agent-policy.constants.ts`
- `apps/core-api/src/mcp/mcp-write-pipeline.service.ts`
- `apps/core-api/src/mcp/mcp-write-tier.util.ts`
- `apps/core-web/src/components/workshop/WorkshopOrderIntakeDialog.tsx`
- `docs/deletion-policy.md`
- `docs/internal/01-ADR/2026-09-27-legal-entity-document-branding.md`
- `docs/internal/01-ADR/2026-08-31-site-operational-scope.md`
- `docs/internal/02-Feature-Specs/Platform/decision-adapter.md`

---

## Linear Tracking

| Field | Value |
|---|---|
| Project | Vehicle Intelligence & Parts Catalog |
| Milestone | |
| Issues | AUT-516. Blocks AUT-537. Related: AUT-395, AUT-527 |
