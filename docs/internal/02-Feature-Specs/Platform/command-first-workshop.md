---
title: "Command-first workshop booking"
date: "2026-10-15"
module: "Platform"
status: draft
linear-project: "Agent-era foundation"
linear-milestone: "Command-first workflows and decision inbox"
tags:
  - feature-spec
  - Platform
---

# Command-first workshop booking

## Summary

> An advisor types or dictates one German sentence and receives either a single reviewable workshop proposal or one exact clarifying question. The sentence may name an existing customer and vehicle, one appointment, local service and parts presets, and an optional loaner. A local deterministic interpreter resolves names, plates, and VINs inside the tenant. It never sends the raw sentence, a name, a plate, or a VIN to OpenRouter, Jev, or any other service. One Apply on the existing `AgentProposal` queue creates the scheduled order, the position plan, and the optional loaner booking together. Cmd+K stays a navigator until [AUT-542](https://linear.app/auto-core-platform/issue/AUT-542). This document is the contract. It contains no product code.

Checked against `main` at `d1bb14539b71d4ad3d03ff0b06c595d8a3700c8c`. The pilot deployment is named **pilot customer** in this spec and in the fixtures.

---

## User Stories

- As an **OWNER or ADMIN**, I want to turn one supported sentence into a preview of an existing customer, their vehicle, a site-local appointment, local presets, and an optional loaner, so that I can accept one proposal.
- As an **OWNER, ADMIN, or SALES** member, I want an exact choice when several customers, vehicles, times, or resources match, so that the system does not pick for me.
- As an **owner**, I want names, plates, and VINs to stay inside the tenant API, so that the flow ships without a provider decision and without [AUT-395](https://linear.app/auto-core-platform/issue/AUT-395).

---

## Scope

In scope for the contract:

- One existing customer and one existing vehicle.
- One appointment on the operative site.
- Closed German date and service grammar listed below.
- Local presets that point at existing `LaborOperation` rows and, optionally, catalog parts.
- Optional `LoanerBooking` in status `RESERVED`.
- Versioned `CommandInput`, `WorkshopIntent`, `Clarification`, and `ProposalResult`.
- Synthetic corpus in [`command-first-workshop/fixtures`](command-first-workshop/fixtures).

Out of scope:

- Creating a customer or a vehicle.
- Supplier orders, payments, invoices, credit notes, consent changes, and customer messages.
- A free tool-calling loop, a general chat, and a second approval queue.
- Replacing the Kostenvoranschlag send dialog, the public customer approval page, or the order communication timeline. Those already exist in [`customer-communication-and-approvals.md`](../Workshop/customer-communication-and-approvals.md) and the notification runbook. This command does not call them.
- Changing `DECISION_USE_CASES`, the OpenRouter client, or AUT-395.

---

## Fixed contracts

`contract_version` is the string `workshop-command/v1`. Any other version returns HTTP 400 `CONTRACT_VERSION_UNSUPPORTED`. JSON objects are closed: unknown properties return HTTP 400 `CONTRACT_UNKNOWN_FIELD`.

The client does not send `tenant_id`, `site_id`, a customer id, or a clock. The tenant comes from the authenticated session (`TenantContextService`). The operative site comes from `SiteContextService.getSite()` (ADR-0022 ruling 7): active tenant membership, active site, active `SiteMembership`. A failure is the existing HTTP 422 `ACTIVE_SITE_REQUIRED`. A later active-site switch does not retarget a stored proposal. Apply requires the caller's operative site to still equal the site stored when the proposal was simulated.

The interpreter clock is the API server clock, frozen in tests by the fixture field `now`. That instant is not a client field. The zone is the `timezone` column on `Site`. `WorkshopScheduleService` reads that same column through `WorkshopSettingsService.getSettingsForSite`, which returns the site row. The interpreter uses that value and does not read the browser zone or a client field. Propose and apply also run the opening-hour and holiday checks already inside booking. A window outside those hours returns HTTP 409 `BAY_UNAVAILABLE` and writes nothing.

### CommandInput

| Field | Type | Rule |
| --- | --- | --- |
| `contract_version` | `"workshop-command/v1"` | Required |
| `command_id` | UUID | Client-generated. Idempotency key for propose |
| `source` | `keyboard` or `voice_transcript` | Audio bytes are not accepted. A transcript is the same text path |
| `locale` | `"de-AT"` | Any other value is HTTP 400 `LOCALE_UNSUPPORTED` |
| `text` | string | Trimmed length 1–500. Longer text is HTTP 400 `TEXT_TOO_LONG` |

```json
{
  "contract_version": "workshop-command/v1",
  "command_id": "51500000-0000-4000-8000-0000000000c1",
  "source": "keyboard",
  "locale": "de-AT",
  "text": "Huber Golf morgen 8 Uhr großes Service + Pickerl, Bremsen vorne prüfen, Leihwagen reservieren"
}
```

### WorkshopIntent

Returned when every required slot is bound. `status` is `ready`. No domain row is written.

| Field | Rule |
| --- | --- |
| `site_id`, `timezone` | Operative site and `Site.timezone` |
| `customer_id`, `vehicle_id` | Tenant rows from local resolution |
| `schedule` | Absolute UTC instants plus the site-local date and `HH:mm` |
| `bay_id` | The single eligible active bay. `mechanic_id` is `null` |
| `loaner` | `requested`. When true, the single eligible `loaner_vehicle_id` and `planned_from` / `planned_to` equal the schedule. When false, `loaner_vehicle_id`, `planned_from`, and `planned_to` are `null` |
| `position_plan` | Version `1`. Lines priced from local master data |
| `purpose` | `CUSTOMER_REPAIR` |
| `order_status` | `SCHEDULED` |
| `reported_issue` | Preset labels joined with `"; "`. The raw sentence is not copied onto the order |

The canonical sentence, with fixture `now` `2026-10-15T14:30:00+02:00` and the corpus world, produces this intent. [`canonical-huber-golf.json`](command-first-workshop/fixtures/canonical-huber-golf.json) is the assertion, including the proposal.

```json
{
  "contract_version": "workshop-command/v1",
  "status": "ready",
  "command_id": "51500000-0000-4000-8000-0000000000c1",
  "site_id": "51500000-0000-4000-8000-000000000010",
  "timezone": "Europe/Vienna",
  "customer_id": "51500000-0000-4000-8000-000000000021",
  "vehicle_id": "51500000-0000-4000-8000-000000000031",
  "schedule": {
    "local_date": "2026-10-16",
    "local_start": "08:00",
    "local_end": "10:30",
    "start_at": "2026-10-16T06:00:00.000Z",
    "end_at": "2026-10-16T08:30:00.000Z",
    "duration_minutes": 150,
    "duration_source": "preset_sum"
  },
  "bay_id": "51500000-0000-4000-8000-000000000041",
  "mechanic_id": null,
  "loaner": {
    "requested": true,
    "loaner_vehicle_id": "51500000-0000-4000-8000-000000000051",
    "planned_from": "2026-10-16T06:00:00.000Z",
    "planned_to": "2026-10-16T08:30:00.000Z"
  },
  "position_plan": {
    "version": 1,
    "lines": [
      {
        "preset_key": "service.major",
        "kind": "LABOR",
        "labor_operation_id": "51500000-0000-4000-8000-000000000061",
        "catalog_item_id": null,
        "description": "Großes Service",
        "quantity": "1.500",
        "unit": "h",
        "unit_price_cents": 9000,
        "net_cents": 13500,
        "reservation": "not_applicable"
      },
      {
        "preset_key": "inspection.pickerl_57a",
        "kind": "LABOR",
        "labor_operation_id": "51500000-0000-4000-8000-000000000062",
        "catalog_item_id": null,
        "description": "Pickerl §57a",
        "quantity": "0.500",
        "unit": "h",
        "unit_price_cents": 9000,
        "net_cents": 4500,
        "reservation": "not_applicable"
      },
      {
        "preset_key": "inspection.brakes_front",
        "kind": "LABOR",
        "labor_operation_id": "51500000-0000-4000-8000-000000000063",
        "catalog_item_id": null,
        "description": "Bremsen vorne prüfen",
        "quantity": "0.500",
        "unit": "h",
        "unit_price_cents": 9000,
        "net_cents": 4500,
        "reservation": "not_applicable"
      }
    ]
  },
  "purpose": "CUSTOMER_REPAIR",
  "order_status": "SCHEDULED",
  "reported_issue": "Großes Service; Pickerl §57a; Bremsen vorne prüfen"
}
```

The canonical file lists all three labor lines. A part preset, when the tenant configures one, adds a line with `kind: "PART"`, `unit` from the catalog item, `reservation: "unbooked"` or `"reserved"`, and `catalog_item_id` set. Labor lines use `reservation: "not_applicable"`.

Price formula, integer half-up, is the only price the preview may show:

`net_cents = round(duration_minutes * unit_price_cents / 60)` for labor.

`net_cents = round(quantity_milli * unit_price_cents / 1000)` for a part, where `quantity_milli` is the preset quantity times 1000.

`quantity` is a three-decimal string. The interpreter does not invent a rate. The rate is the linked `LaborOperation` hourly rate or the catalog net price at preview time.

### Clarification

`status` is `clarification`. `proposal` is `null`. Exactly one `code` is returned, the first hit in the precedence list in [Resolution](#resolution). `choices` is the complete set the advisor may answer with. An empty `choices` array means the sentence cannot continue until the text changes. There is no choice that creates a customer, a vehicle, or a preset.

```json
{
  "contract_version": "workshop-command/v1",
  "status": "clarification",
  "command_id": "51500000-0000-4000-8000-0000000000c2",
  "code": "CUSTOMER_AMBIGUOUS",
  "prompt": "Mehrere Kunden passen. Bitte einen auswählen.",
  "choices": [
    {
      "choice_id": "customer:51500000-0000-4000-8000-000000000021",
      "slot": "customer_id",
      "value": "51500000-0000-4000-8000-000000000021",
      "label": "Alex Huber — Golf — W-SYN 515"
    }
  ],
  "recognized": {
    "customer_token": "Huber",
    "vehicle_token": "Golf"
  },
  "proposal": null
}
```

A follow-up `CommandInput` reuses the same `command_id` and repeats the full text plus `selections`: an array of `{ "slot", "value" }` taken from `choices`. Interpret updates that one session row. The "normalized input differs" check compares token fields only: `identity`, `day`, `start_clock`, `end_clock`, `preset_keys`, `loaner_requested`, and `named_site`. `selections` and `offered_choices` are not part of that compare, so adding a selection is not `COMMAND_ID_REUSED`. Selections cannot introduce a slot the clarification did not offer. A follow-up is valid only while no `AgentProposal` exists for that `command_id`. After propose, the selection set is frozen.

### ProposalResult

Propose stores one `AgentProposal` and returns this body. `applied` is `false`. `provisional` is `true`. `would_change` ids are `null`.

```json
{
  "contract_version": "workshop-command/v1",
  "status": "needs_approval",
  "command_id": "51500000-0000-4000-8000-0000000000c1",
  "pending_action_id": "51500000-0000-4000-8000-0000000000a1",
  "trace_id": "51500000-0000-4000-8000-0000000000b1",
  "action_type": "workshop.booking_package",
  "tier": "PROPOSE",
  "provisional": true,
  "applied": false,
  "would_change": [
    {
      "entity": "WorkshopOrder",
      "op": "create",
      "provisional": true,
      "id": null,
      "status": "SCHEDULED",
      "site_id": "51500000-0000-4000-8000-000000000010"
    },
    {
      "entity": "WorkshopTask",
      "op": "create",
      "provisional": true,
      "id": null,
      "status": "NOT_STARTED",
      "count": 3
    },
    {
      "entity": "WorkshopTaskLineItem",
      "op": "create",
      "provisional": true,
      "id": null,
      "count": 3
    },
    {
      "entity": "LoanerBooking",
      "op": "create",
      "provisional": true,
      "id": null,
      "status": "RESERVED"
    }
  ]
}
```

`intent` is required on `ProposalResult`. It is the `WorkshopIntent` above without `status`. The canonical fixture checks that equality.

Apply is the existing `POST /api/agent-proposals/:id/apply`. It is one proposal, one executor call, one database transaction. `POST /api/agent-proposals/batch-apply` is not the package operation. Success ends in `AgentProposalStatus.EXECUTED`. Pending is not success.

---

## Supported inputs

Normalization starts with Unicode NFC, trim, and collapsed whitespace. Case stays in place for this pass. Plate and VIN spans are found on that string, case-insensitively, before the string is split on spaces, so `W-SYN 515` is one plate. Clock spans are found the same way. The remainder is lowercased with German `de-AT` for phrase matching. `ß` stays `ß`. ASCII aliases in the phrase table are accepted as written. `,`, `+`, and `und` are clause separators only outside plate, VIN, and clock spans.

The command shape is:

`identity time clauses`

`identity` is either `surname vehicle-model` or one plate or one VIN.

`time` is one day word plus one start clock, optionally `bis` plus an end clock.

Day words: `heute`, `morgen`, `übermorgen`, `uebermorgen`, `montag`, `dienstag`, `mittwoch`, `donnerstag`, `freitag`, `samstag`, `sonntag`, or `am D.M.` / `am D.M.YYYY` with numeric day and month.

Clocks: `H Uhr`, `HH Uhr`, `H:mm`, `HH:mm`, each optionally prefixed by `um` and optionally suffixed by `Uhr`. Hours are integers `0`–`23`. `24:00` is rejected.

| Phrase after normalization | Preset key | Effect |
| --- | --- | --- |
| `großes service`, `grosses service` | `service.major` | Labor line |
| `kleines service` | `service.minor` | Labor line |
| `pickerl`, `§57a`, `57a` | `inspection.pickerl_57a` | Labor line |
| `bremsen vorne prüfen`, `bremsen vorne pruefen` | `inspection.brakes_front` | Labor line |
| `bremsen hinten prüfen`, `bremsen hinten pruefen` | `inspection.brakes_rear` | Labor line |
| `ölwechsel`, `oelwechsel` | `service.oil` | Labor line |
| `leihwagen reservieren`, `leihwagen` | `loaner.reserve` | Loaner flag, not a line |
| `standort` plus the site `code` or the full site `name` | site constraint | Case-insensitive exact match on `code`, or case-insensitive exact match on the full `name`. `Nord` does not match `Pilot Nord` |

A plate token matches `^[A-ZÄÖÜ]{1,2}-?[A-Z]{1,4}[ -]?[0-9]{1,5}[A-Z]?$` after uppercasing. A VIN token is 17 characters from `A–Z` and `0–9` excluding `I`, `O`, and `Q`. Both resolve only against the tenant database.

Weekday means the next calendar date strictly after the site-local date of `now`. `heute` is that local date. `morgen` is the next calendar date. `übermorgen` is two calendar dates ahead. Calendar addition is in `Site.timezone`, including across DST.

These sentences are outside the grammar and return one clarification or one error. They never become a free-text line, a guessed part, or a tool call:

- More than one appointment, a price, a duration in words, or a mechanic name.
- A part name that is not a preset phrase (`Bremsbeläge`).
- `neuer Kunde`, `Fahrzeug anlegen`, `löschen`, `stornieren`.
- `KVA senden`, `Kostenvoranschlag senden`, `Rechnung`, `bezahlen`, `mailen`, `anrufen`. Those return `HUMAN_ONLY_EXCLUDED`.

---

## Resolution

Precedence, first match wins. Later slots stay in `recognized` only as raw tokens, not as guessed ids.

1. `HUMAN_ONLY_EXCLUDED`
2. `UNSUPPORTED_GRAMMAR`
3. `TIME_CONTRADICTORY` when two start clocks appear, or when `bis` ends at or before the start
4. `UNSUPPORTED_SERVICE` when a clause is not in the phrase table
5. `SITE_MISMATCH` when a named site is not the operative site
6. `CUSTOMER_NOT_FOUND`, `CUSTOMER_AMBIGUOUS`, `VEHICLE_NOT_FOUND`, `VEHICLE_AMBIGUOUS`, `IDENTITY_CONTRADICTION`
7. `TIME_DOES_NOT_EXIST`, `TIME_AMBIGUOUS`, `TIME_IN_PAST`
8. `PRESET_NOT_CONFIGURED`, `DURATION_REQUIRED`
9. `RESOURCE_MISSING`, `RESOURCE_AMBIGUOUS`, `LOANER_NOT_PERMITTED`

### Local identity

Customer: case-insensitive exact `Customer.last_name` or `Customer.company_name` in the tenant. `Huber` does not match `Huberer`. Plate: uppercase, strip spaces and hyphens, exact against `Vehicle.plate` normalized the same way. VIN: exact against `Vehicle.vin`. Model: case-insensitive exact `Vehicle.model` among the bound customer's vehicles. `Golf` does not match `Golf Variant`.

A plate or VIN that belongs to a different customer than the surname is `IDENTITY_CONTRADICTION`. Entity choices are ordered by `value` ascending. DST choices are ordered by the UTC instant ascending. Conflicting clocks keep the order they have in the sentence.

### Time

Build the site-local date, then the wall clock. Convert with an explicit offset check:

- If the wall clock does not exist (spring forward), `TIME_DOES_NOT_EXIST`. Do not shift the clock.
- If the wall clock exists twice (fall back), `TIME_AMBIGUOUS`. The choices are the two UTC instants. Do not prefer the earlier one.
- If `start_at` is less than or equal to `now`, `TIME_IN_PAST`.

`8 Uhr` on the 2026-10-25 Europe/Vienna fallback is unambiguous. `2:30` on that date is the overlap fixture. `2:30` on 2027-03-28 Europe/Vienna is the gap fixture.

End time is the `bis` clock when present. Otherwise it is the sum of labor preset `duration_minutes`. A labor preset without a duration and without `bis` is `DURATION_REQUIRED`.

At site-local midnight the local date is the new date, so `morgen` is the day after that date. `2026-10-16T00:00:00+02:00` in `Europe/Vienna` makes `morgen` `2026-10-17`. `2026-10-15T23:59:00+02:00` makes `morgen` `2026-10-16`.

### Resources

Eligible bays: active bays on the operative site whose window does not overlap an active workshop order, using the same occupancy rule as `WorkshopScheduleService.assertCanBook`. Eligible loaners: active `LoanerVehicle` rows on that site in `AVAILABLE`, with no overlapping `RESERVED` or `HANDED_OVER` booking.

| Eligible count | Result |
| --- | --- |
| 0 bays | `RESOURCE_MISSING` with `choices: []` |
| 1 bay | Bind it and show it in the preview |
| 2 or more bays | `RESOURCE_AMBIGUOUS`. Each choice has `slot` `bay_id` and `value` set to that bay's id |
| 0 loaners and loaner requested | `RESOURCE_MISSING`. The only choice is `continue_without_loaner` |
| 1 loaner | Bind it |
| 2 or more loaners | `RESOURCE_AMBIGUOUS`. Each loaner choice has `slot` `loaner_vehicle_id` and `value` set to that loaner's id. One more choice has `slot` `loaner` and `value` `continue_without_loaner` |

An empty `choices` array means the advisor continues only by sending a new sentence. Closing the dialog writes nothing, so the contract has no `stop` choice.

A free bay or loaner on another site is not a choice. The code is `RESOURCE_MISSING` for the operative site. A named site is not booked when the caller lacks an active `SiteMembership` there. `wrong-site.json` sets that membership inactive and asserts the named site is not queried.

Loaner writes use `LoanerVehiclesAuthorization.assertWriteAccess`: tenant role `OWNER` or `ADMIN`, or an active `Employee` with role `SERVICE_ADVISOR` linked to the caller. Interpret returns `LOANER_NOT_PERMITTED` with the single choice `continue_without_loaner` when that check fails. That is the reachable case, and the caller is `SALES`. `OWNER` and `ADMIN` always pass `assertWriteAccess`, and they are the only roles that reach propose and apply, so HTTP 403 `LOANER_FORBIDDEN_WRITE` does not occur on this command. The executor still calls `assertWriteAccess` so a later role change cannot skip it. There is no E2E that expects that 403.

### Queries

Load customers, then vehicles for the matched customer ids or the plate/VIN, then presets, bays, and loaners for the operative site. At most one query per set, using `IN` lists. The phrase loop does not query. Other sites are not queried when the named site already mismatches.

### No silent guess

- Zero matches do not create a row.
- Two matches do not keep the first row.
- Two resources do not keep the first free resource.
- An unknown clause does not become a zero-price line.
- A known phrase without a preset row does not pick a labor operation by name.
- A missing loaner does not drop the request.
- A past time does not roll forward to the next day.
- A DST gap does not move to the next valid hour.
- A forbidden clause is not stripped so the rest can book.
- Preview prices are recomputed on apply. A changed rate, a changed preset, or a changed occupancy returns HTTP 409 `PLAN_STALE` and writes nothing.

### Provider boundary

v1 calls no `DecisionProvider`. `DECISION_USE_CASES` stays `import_row_matching` and `document_sort`. The optional future adapter may receive only this value:

```json
{
  "contract_version": "workshop-command/v1",
  "tokens": [
    { "kind": "preset", "value": "service.major" },
    { "kind": "unknown", "value": "unknown" }
  ]
}
```

`unknown` is the literal word `unknown`, never the source text. The adapter is not registered in v1. AUT-395 is not a dependency. A test must fail if any outbound body to OpenRouter, Jev, or a new host contains the raw `text`, a customer name, a plate, or a VIN. Fixture [`no-provider-pii.json`](command-first-workshop/fixtures/no-provider-pii.json) records that assertion.

---

## Fixed booking proposal and position plan

[AUT-535](https://linear.app/auto-core-platform/issue/AUT-535) and [AUT-540](https://linear.app/auto-core-platform/issue/AUT-540) implement this package. They do not define a second payload.

| Slot on `WorkshopIntent` | Owner | Apply effect |
| --- | --- | --- |
| `customer_id`, `vehicle_id`, `schedule`, `bay_id`, `loaner` | AUT-535 | `WorkshopOrder` `SCHEDULED` via `WorkshopIntakeService.createAtSite`, and optionally `LoanerBooking` `RESERVED` linked to that order |
| `position_plan` | AUT-540 | One `WorkshopTask` per labor or part line, status `NOT_STARTED`, lines priced from the recomputed plan. Catalog part reservations go through `PartsRequisitionService` |

Action key: `workshop.booking_package`. Platform policy row: tier `PROPOSE`, `enabled: false`. `AUTO` ranks looser than `PROPOSE` (`TIER_RANK` in `agent-policy-tier.util.ts`). A tenant upsert that sets `AUTO` is rejected with HTTP 422 `AGENT_POLICY_LOOSER_THAN_PLATFORM`. The evaluator does not clamp the tier. A stricter tenant tier such as `HUMAN_ONLY` is stored. A missing rule evaluates to `HUMAN_ONLY` with reason `unknown_action_fail_closed`. A disabled rule evaluates to `HUMAN_ONLY` with reason `rule_disabled_fail_closed` (`agent-policy.evaluator.ts`). REST propose then follows `submitPendingAction`: when the tier is not `PROPOSE`, it throws HTTP 422 `UnprocessableEntityException` with the message `Only actions currently evaluated as PROPOSE can be submitted for approval`, and it stores nothing. That 422 applies once slice 3 routes propose through `submitPendingAction`. Slice 2 `buildProposal` does not evaluate the policy row. That response has no `not_permitted` code. HTTP 403 `not_permitted` exists on the MCP write path only. v1 registers no MCP tool for this action. A later typed MCP tool, if added, uses this payload and that MCP path.

`HUMAN_ONLY` floor actions in `agent-policy-floor.ts` are never emitted. The never-exposed MCP actions, including `estimate.send_customer_message`, `invoice.finalize`, `invoice.send`, and `invoice.cancel`, are never emitted. A `HUMAN_ONLY` evaluation does not preview and does not execute.

If `position_plan.lines` is non-empty before the AUT-540 executor is deployed, apply returns HTTP 409 `POSITION_PLAN_EXECUTOR_REQUIRED` and creates no order and no loaner. Lines are not dropped.

Today `submitPendingAction`, `assertSiteMatchesSimulation`, and the apply execution context capture `site_id` only when `action_type` is `workshop_order.create`. AUT-535 extends those three branches to `workshop.booking_package` as well. Simulation stores `preview_json.execution_context.site_id` from `SiteContextService.getSiteId()` at submit. Apply requires the caller's operative site to still equal that stored id. A mismatch is the existing HTTP 422 `Select the site where this action was simulated before applying it`. A site change during simulation is the existing HTTP 422 `The active site changed while the pending action was simulated`. Apply also re-checks policy, membership, bay occupancy, loaner write access, loaner overlap, and prices. Bay conflict and loaner overlap stay HTTP 409 from the domain services. Both writes roll back together.

Existing estimate send, public approval, and the communication timeline remain the next manual steps after `EXECUTED`. Start Service consumes the stored plan and must not duplicate tasks, lines, or reservations (AUT-540).

Idempotency is in [Replay storage](#replay-storage). A second propose with the same `command_id`, the same tokens, and the same selections returns the existing `PENDING` proposal.

---

## Error codes

| Code | HTTP | When |
| --- | --- | --- |
| `ACTIVE_SITE_REQUIRED` | 422 | Existing site-context failure |
| `CONTRACT_VERSION_UNSUPPORTED` | 400 | Version is not `workshop-command/v1` |
| `CONTRACT_UNKNOWN_FIELD` | 400 | Closed object rejected a field |
| `LOCALE_UNSUPPORTED` | 400 | `locale` is not `de-AT` |
| `TEXT_TOO_LONG` | 400 | Text longer than 500 characters |
| `AGENT_POLICY_LOOSER_THAN_PLATFORM` | 422 | Tenant policy upsert sets a tier looser than the platform row |
| Propose tier is not `PROPOSE` | 422 | Message `Only actions currently evaluated as PROPOSE can be submitted for approval`. No application code |
| Supervisor role missing | 403 | `ForbiddenException` text `Supervision access is restricted to OWNER, ADMIN, and ADVISOR roles only.` No `not_permitted` code |
| `LOANER_NOT_PERMITTED` | 200 as clarification | Interpret, loaner requested, caller fails the loaner write rule. Reachable for `SALES` |
| `INTENT_INCOMPLETE` | 409 | Propose while the recomputed result is still a clarification |
| `COMMAND_ID_REUSED` | 409 | Tokens differ from the stored command, or an `AgentProposal` for this `command_id` is not `PENDING`. A matching `PENDING` proposal is HTTP 200 |
| `SELECTION_NOT_OFFERED` | 409 | A propose `selections` entry is not in the session's `offered_choices` |
| `SESSION_NOT_FOUND` | 404 | Propose has no session and no `AgentProposal` for that `command_id` |
| `PLAN_STALE` | 409 | Price, preset, site, or occupancy changed after preview |
| `POSITION_PLAN_EXECUTOR_REQUIRED` | 409 | Lines present and the position executor is absent |
| `BAY_UNAVAILABLE` | 409 | Domain booking conflict, including outside opening hours |
| Clarification codes below | 200 | Interpret succeeded with `status: "clarification"` |

Clarification prompts are fixed:

| Code | Prompt |
| --- | --- |
| `HUMAN_ONLY_EXCLUDED` | Diese Aktion bleibt bei einer Person und wird nicht vorgeschlagen. |
| `UNSUPPORTED_GRAMMAR` | Der Satz liegt außerhalb der unterstützten Eingaben. |
| `TIME_CONTRADICTORY` | Zwei Uhrzeiten widersprechen sich. Bitte eine wählen. |
| `UNSUPPORTED_SERVICE` | Diese Leistung ist nicht in der lokalen Liste. |
| `SITE_MISMATCH` | Der genannte Standort ist nicht der aktive Standort. |
| `CUSTOMER_NOT_FOUND` | Kein Kunde mit diesem Namen im Mandanten. |
| `CUSTOMER_AMBIGUOUS` | Mehrere Kunden passen. Bitte einen auswählen. |
| `VEHICLE_NOT_FOUND` | Beim Kunden gibt es kein passendes Fahrzeug. |
| `VEHICLE_AMBIGUOUS` | Mehrere Fahrzeuge passen. Bitte eines auswählen. |
| `IDENTITY_CONTRADICTION` | Name und Kennzeichen passen nicht zusammen. |
| `TIME_DOES_NOT_EXIST` | Diese Uhrzeit gibt es an diesem Tag nicht. |
| `TIME_AMBIGUOUS` | Diese Uhrzeit gibt es an diesem Tag zweimal. Bitte eine wählen. |
| `TIME_IN_PAST` | Der Termin liegt in der Vergangenheit. |
| `PRESET_NOT_CONFIGURED` | Die Leistung ist erkannt, aber am Standort nicht hinterlegt. |
| `DURATION_REQUIRED` | Ohne Endzeit oder hinterlegte Dauer kann der Termin nicht berechnet werden. |
| `RESOURCE_MISSING` | Keine freie Ressource am aktiven Standort. |
| `RESOURCE_AMBIGUOUS` | Mehrere Ressourcen passen. Bitte eine wählen. |
| `LOANER_NOT_PERMITTED` | Leihwagen können mit diesem Konto nicht reserviert werden. |

| Code | `choices` |
| --- | --- |
| `HUMAN_ONLY_EXCLUDED`, `UNSUPPORTED_GRAMMAR`, `UNSUPPORTED_SERVICE`, `CUSTOMER_NOT_FOUND`, `VEHICLE_NOT_FOUND`, `IDENTITY_CONTRADICTION`, `TIME_DOES_NOT_EXIST`, `TIME_IN_PAST`, `PRESET_NOT_CONFIGURED`, `DURATION_REQUIRED` | `[]`. The advisor sends a new sentence |
| `CUSTOMER_AMBIGUOUS` | One choice per matching customer, `slot` `customer_id` |
| `VEHICLE_AMBIGUOUS` | One choice per matching vehicle, `slot` `vehicle_id` |
| `TIME_CONTRADICTORY` | One choice per conflicting clock, `slot` `local_start` |
| `TIME_AMBIGUOUS` | The two UTC instants, `slot` `start_at` |
| `SITE_MISMATCH` | One choice, `value` `continue_at_operative_site`. The named site is not a choice, including when the caller has no active membership there |
| `RESOURCE_MISSING` for a bay | `[]` |
| `RESOURCE_MISSING` for a loaner | One choice, `value` `continue_without_loaner` |
| `RESOURCE_AMBIGUOUS` | Bays: `slot` `bay_id`, `value` the bay id. Loaners: `slot` `loaner_vehicle_id`, `value` the loaner id, plus `slot` `loaner`, `value` `continue_without_loaner` |
| `LOANER_NOT_PERMITTED` | One choice, `slot` `loaner`, `value` `continue_without_loaner` |

---

## Database Impact

### New Tables / Columns

Added by the implementation slices, not by this spec PR.

| Table | Column | Type | Nullable | Notes |
| --- | --- | --- | --- | --- |
| `workshop_command_presets` | `id` | uuid | no | Tenant preset row. AUT-540 |
| `workshop_command_presets` | `tenant_id` | uuid | no | From auth context on write |
| `workshop_command_presets` | `site_id` | uuid | yes | Null means tenant-wide. A site row overrides it |
| `workshop_command_presets` | `preset_key` | text | no | Closed keys from the phrase table |
| `workshop_command_presets` | `kind` | text | no | `LABOR`, `PART`, or `LOANER_FLAG` |
| `workshop_command_presets` | `labor_operation_id` | uuid | yes | Required for `LABOR` |
| `workshop_command_presets` | `catalog_item_id` | uuid | yes | Required for `PART` |
| `workshop_command_presets` | `duration_minutes` | int | yes | Labor presets used for the end time |
| `workshop_command_presets` | `quantity_milli` | int | yes | Part quantity times 1000 |
| `workshop_command_presets` | `active` | boolean | no | Default true |
| `agent_proposals` | `command_id` | uuid | yes | Unique `(tenant_id, command_id)`. Interpreter slice |
| `workshop_command_sessions` | `id` | uuid | no | Replay row for one `command_id`. Interpreter slice |
| `workshop_command_sessions` | `tenant_id` | uuid | no | From auth context |
| `workshop_command_sessions` | `command_id` | uuid | no | Unique with `tenant_id` |
| `workshop_command_sessions` | `site_id` | uuid | no | Operative site at interpret |
| `workshop_command_sessions` | `source` | text | no | `keyboard` or `voice_transcript` |
| `workshop_command_sessions` | `normalized_json` | jsonb | no | Structured parse. No raw `text` field |
| `workshop_command_sessions` | `expires_at` | timestamptz | no | `created_at` plus 7 days. On propose, `min` of that instant and the proposal `expires_at`. Never later than 7 days after the session row |

Preset lookup prefers the operative site row and otherwise the tenant-wide row. Prices stay on `LaborOperation` and `CatalogItem`. The preset does not store a price.

### Replay storage

The raw sentence and the voice transcript are not stored. Interpret writes `workshop_command_sessions.normalized_json` with this shape:

```json
{
  "identity": { "kind": "surname_model", "surname": "Huber", "model": "Golf" },
  "day": { "kind": "relative", "word": "morgen" },
  "start_clock": "08:00",
  "end_clock": null,
  "preset_keys": ["service.major", "inspection.pickerl_57a", "inspection.brakes_front"],
  "loaner_requested": true,
  "named_site": null,
  "selections": [],
  "offered_choices": []
}
```

`identity.kind` is `surname_model`, `plate`, or `vin`. The matching token fields are `surname` and `model`, or `plate`, or `vin`. Those tokens are identifying. They live only in this table, for at most 7 days. `named_site` is the matched site code when the clause was present, otherwise `null`.

`offered_choices` is the exact `{ "slot", "value" }` list returned on the last clarification. A ready interpret stores `[]`. Propose accepts a selection only when that pair is in `offered_choices`. Any other pair is HTTP 409 `SELECTION_NOT_OFFERED`. The server then recomputes the intent from the normalized tokens, the accepted selections, and the live tenant rows. A selected id that no longer resolves is HTTP 409 `PLAN_STALE`.

Interpret and propose load `AgentProposal` for the authenticated tenant and `command_id`. `command_fingerprint` is the SHA-256 of the canonical token object plus the accepted `selections`. It is stored at `preview_json.command_fingerprint`. It is not a field of `WorkshopIntent` and it is not written into `payload_json`. The fingerprint contains no raw sentence.

`reviewed_fingerprint` in the replay row is the SHA-256 of the ready `WorkshopIntent` the advisor last saw, with `command_id` held constant, or `null` when the last interpret ended in a clarification. Propose recomputes the intent from the live tenant rows and compares. A different hash — a changed labor price, a changed preset, a relative day that crossed midnight, a different bay or loaner — is HTTP 409 `PLAN_STALE` and writes nothing. The advisor reviews the new plan by interpreting again.

| Caller | Existing proposal | Input | Result |
| --- | --- | --- | --- |
| Propose | none, session exists | ready intent | Slice 3 inserts one `PENDING` row and returns HTTP 201, matching `POST /api/agent-proposals/submit` |
| Propose | `PENDING` | same tokens and same selections | HTTP 200 with that row's `pending_action_id` and `trace_id` |
| Propose | `PENDING` | tokens or selections differ | HTTP 409 `COMMAND_ID_REUSED` |
| Propose | any status other than `PENDING` | any | HTTP 409 `COMMAND_ID_REUSED`, including when the session row is already gone |
| Propose | none and no session | any | HTTP 404 `SESSION_NOT_FOUND` |
| Interpret | none and no session | first command | HTTP 200, insert one session row |
| Interpret | none, session exists | same tokens, selections added from `offered_choices` | HTTP 200, update the one session row |
| Interpret | none, session exists | tokens differ | HTTP 409 `COMMAND_ID_REUSED` |
| Interpret | `PENDING` | same tokens and same selections | HTTP 200 ready intent. No second proposal |
| Interpret | `PENDING` | tokens or selections differ | HTTP 409 `COMMAND_ID_REUSED` |
| Interpret | not `PENDING` | any | HTTP 409 `COMMAND_ID_REUSED` |

A double submit, a timeout retry, or a reload uses the same `command_id` and receives the same pending ids. That is the AUT-542 retry rule. The fingerprint check does not need the session row, so it still works after `deleteCommandReplays`.

Propose sends only `contract_version`, `command_id`, and `selections`. A client field other than those three is HTTP 400 `CONTRACT_UNKNOWN_FIELD`. Prices, customer ids, and site ids in a propose body are not accepted.

`AgentProposal.payload_json` is the recomputed `WorkshopIntent` (ids, instants, preset keys, prices) and nothing else. `POST /api/agent-proposals/submit` accepts that object only. `agent_action_log.inputSummary.payload` is that same object. It has no `text`, surname, plate, VIN, or `command_fingerprint`. `resultSummary` keeps `would_change` and ids. The fingerprint stays on `preview_json`, which is retained with the proposal row, so the retry check still works after `deleteCommandReplays`.

The interpreter slice owns session deletion. `deleteCommandReplays(client, tenantId, commandIds)` in `workshop-command-session-cleanup.ts` hard-deletes those rows and skips command ids that are null. AUT-535 calls it in the same transaction when a proposal that has a `command_id` leaves `PENDING` through apply (`EXECUTED`), an executor failure (`FAILED`), reject (`REJECTED`), or an expire path (`EXPIRED`). `AgentProposalReadService` also bulk-expires `PENDING` rows with `updateMany` on the list endpoints, and does not delete there. Two bounds cover that path: proposing freezes the row to `min(session.created_at + 7 days, proposal.expires_at)`, never later, so a bulk-expired proposal's row is already past its own retention; and `workshop-command-session-purge` (`WorkshopCommandSessionRetentionService`) sweeps every tenant hourly, so an advisor who stops using the command box still loses the surname, plate, and VIN tokens instead of waiting out seven days. Interpret and propose still purge the calling tenant's expired rows first, and tenant deletion deletes the rows with the tenant.

The interpreter-slice migration adds `workshop_command_sessions` and `agent_proposals.command_id` to the tenant-restore manifest by running `node tools/tenant-restore/generate-tenant-restore-sql.mjs` and committing the generated SQL. AUT-540 does the same for `workshop_command_presets`, and in that same PR adds the preset row to `docs/deletion-policy.md`. The interpreter slice adds the session row to that policy in its own PR.

### Modified Tables

| Table | Change | Migration Required? |
| --- | --- | --- |
| `agent_proposals` | Nullable `command_id` plus unique `(tenant_id, command_id)` | Yes, in the interpreter slice |
| `agent_policy_rules` | Seed `workshop.booking_package` as disabled `PROPOSE` | Yes, in AUT-535 |

No change to `InventoryStock` except through `InventoryTransaction` inside `PartsRequisitionService`. No invoice table is written. `FinanceSettings.lock_date` is not involved. Workshop order numbers keep the existing singleton counter inside the intake transaction.

### Deletion Policy Impact

This spec PR does not add a table, so `docs/deletion-policy.md` stays unchanged here. The AUT-540 migration PR adds:

| Entity | Rule |
| --- | --- |
| `WorkshopCommandPreset` | Soft-disable with `active = false`. Hard delete is refused while the row is referenced by a pending `workshop.booking_package` payload. AUT-540 updates `docs/deletion-policy.md`. |
| `WorkshopCommandSession` | Hard delete when the linked proposal leaves `PENDING`, when `expires_at` is past, and on tenant deletion. Ordinary APIs expose no delete route. The interpreter slice updates `docs/deletion-policy.md`. |
| `AgentProposal` | Unchanged. Retained, including `preview_json` and `command_id`. |

`WorkshopOrder`, `WorkshopTask`, `WorkshopTaskLineItem`, and `LoanerBooking` keep their current deletion rules. The package does not add a cascade that deletes a customer or a vehicle.

### State

No new status values.

| Entity | Status written by Apply |
| --- | --- |
| `WorkshopOrder` | `SCHEDULED` |
| `WorkshopTask` | `NOT_STARTED` |
| `LoanerBooking` | `RESERVED` |
| `AgentProposal` | `PENDING` on propose. Apply of a live row ends `EXECUTED` or `FAILED` |

`AgentProposal.expires_at` stays the database default of seven days. Apply of a row past `expires_at` marks it `EXPIRED` and does not execute, which is the current decision-service behavior. Reject marks it `REJECTED` and does not execute. `preview_json` remains on the retained proposal row. Apply, reject, and both expire paths call `deleteCommandReplays`. A later interpret or propose with the same `command_id` returns `COMMAND_ID_REUSED` because the proposal row remains and is not `PENDING`. The next sentence uses a new `command_id`. A retry while the row is still `PENDING` returns that same row.

Apply does not move the order to `INTAKE`. Existing `updateMany` status guards stay in the domain services.

### Real-time sync

`WorkshopCommandSession` and `WorkshopCommandPreset` are not added to `SUPPORTED_ENTITY_TYPES`. `WorkshopOrder` and `AgentProposal` keep their current sync behavior.

---

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
| --- | --- | --- | --- | --- |
| `POST` | `/api/workshop/commands/interpret` | `CommandInput` plus optional `selections` | `WorkshopIntent` or `Clarification` | Active site membership and tenant role `OWNER`, `ADMIN`, or `SALES`. No domain writes. Writes one session row |
| `POST` | `/api/workshop/commands/propose` | `{ contract_version, command_id, selections }` | `ProposalResult` with `pending_action_id` and `trace_id`. First persist is HTTP 201. A matching `PENDING` retry is HTTP 200 | Tenant role `OWNER` or `ADMIN`. Route registered in slice 3. Until then only `buildProposal` exists, and its result omits those two ids |

`TenantMemberRole` is `OWNER`, `ADMIN`, `TECH`, and `SALES`. There is no `ADVISOR` tenant role. `assertSupervisor` still lists the string `ADVISOR`, and this spec does not add that role or change the guard. With the roles that exist, only `OWNER` and `ADMIN` pass propose and apply. `SALES` may interpret and receives HTTP 403 on propose and apply. `TECH` receives HTTP 403 on interpret, propose, and apply. The 403 body stays the current `ForbiddenException` text and has no `not_permitted` code. Giving `SALES` propose access is a separate authorization change.

The source of truth for propose is the session row plus the `AgentProposal` lookup above. Selections must be pairs stored in `offered_choices`.

### Modified Endpoints

| Method | Route | Change Description |
| --- | --- | --- |
| `POST` | `/api/agent-proposals/:id/apply` | Unchanged route. The new action key is one more executor branch |
| `POST` | `/api/agent-proposals/submit` | Accepts `workshop.booking_package` only when the payload matches `WorkshopIntent` |

MCP `draft_workshop_order`, `propose_line_item`, and `reserve_part` stay single-action tools. This feature does not add a natural-language MCP tool.

### OpenAPI Regeneration

When AUT-535 or AUT-540 changes DTOs:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

This spec PR changes neither artefact.

---

## UX Compliance

The UI slice is [AUT-542](https://linear.app/auto-core-platform/issue/AUT-542). `GlobalSearch` keeps navigation. The command preview is a separate mode in that dialog.

### Layout & Actions

- [x] Apply sits top-right in the preview. Interpret and propose are not page-level creates.
- [x] Title and the operative site badge stay top-left.
- [x] The preview header uses `text-2xl font-semibold tracking-tight` when AUT-542 builds it.
- [x] Subtitle uses `text-slate-500`.

### List Pages (if applicable)

No new list page. The existing Approvals list shows the pending proposal. Search, sort, `StatusBadge`, and row navigation stay as they are.

### Form Handling

The sentence field submits on an explicit Interpret action. It is not an auto-saved entity. AUT-542 shows an editable preview: the advisor changes a supported slot by sending `selections` or a new `CommandInput`, and the server recomputes. Prices, preset rates, and the operative site are not editable fields. Voice uses the existing advisor speech route, checks that route's permission, and submits the transcript as `source: voice_transcript`. The transcript is not sent to Jev. Apply is the only domain write.

### Real-Time Sync

- [x] No new entity type for the command.
- [x] No new dashboard query key.

---

## Component Design

| Component | Location | Purpose |
| --- | --- | --- |
| `GlobalSearch` | `apps/core-web/src/components/GlobalSearch.tsx` | Unchanged navigator. AUT-542 adds the command mode beside it |
| `WorkshopCommandPreview` | `apps/core-web/src/features/workshop-command/` | AUT-542 only. Calls the command endpoints and renders one clarification or one `ProposalResult` |

| Module | Location | Owner |
| --- | --- | --- |
| Local interpreter and `POST /interpret` | `apps/core-api/src/workshop-command/` | Interpreter slice. AUT-535 registers `POST /propose`. AUT-542 consumes both |
| Executor branch | `pending-action-executor.service.ts` | AUT-535 |

---

## Testing Plan

The corpus is the acceptance test. A future test loads every file in [`fixtures`](command-first-workshop/fixtures), merges `world_patch` with RFC 7396 onto [`world.json`](command-first-workshop/fixtures/world.json), and freezes `now`. A file with `cases` runs each case. When `expect.body` contains `position_plan` or `code`, it deep-equals the response body. Otherwise it is a deep subset of that body. `$anyUuid` matches any UUID. Omitted `http_status` means 200. `provider_invoked` is `false` and `outbound_bodies` is `[]`. Every string in `forbidden_substrings` is absent from `outbound_bodies`. Fields next to `body` are exact when present, including `queries_other_site` and `named_site_membership_active`. The loader reads `world.caller.site_memberships`. A site counts as a membership only when that list has a row for the site with `is_active: true`. `named_site_membership_active` is true only when that membership exists for the site whose `code` equals `recognized.named_site_code`. `slice` names which implementation slice asserts that block: `2` is `buildProposal`, `3` is the persisted route. `retry_returns_same_ids` means a second propose with the same tokens and selections returns the same `pending_action_id` and `trace_id` and inserts no second row. `retry_http_status` is the status of that second call. On `canonical-huber-golf.json`, slice 2 compares `buildProposal` to `propose_expect.body`, which has no `pending_action_id` and no `trace_id`. Slice 3 compares the first persisted `POST /propose` response to `propose_persist_expect`: HTTP 201, and the body includes those ids. The retry is HTTP 200 with the same ids. `domain_rows_before_apply` is empty: no `WorkshopOrder`, `WorkshopTask`, `WorkshopTaskLineItem`, `LoanerBooking`, or `PartsReservation` exists before Apply.

| Fixture | Acceptance case |
| --- | --- |
| `canonical-huber-golf.json` | The Huber Golf sentence has a ready intent and one proposal |
| `multiple-huber-golf.json` | Two customers named Huber, each with a Golf |
| `multiple-golfs-one-huber.json` | One Huber, two Golfs |
| `no-match.json` | No customer named Huber |
| `dst-overlap.json` | 2026-10-25 02:30 Europe/Vienna, two instants |
| `dst-gap.json` | 2027-03-28 02:30 Europe/Vienna, missing instant |
| `morgen-midnight.json` | `morgen` at 00:00 and at 23:59 |
| `unsupported-service.json` | `Klimaservice` |
| `wrong-site.json` | `Standort NORD` while the operative site is `WIE`, and the caller has no active membership on `NORD` |
| `contradictory-time.json` | `8 Uhr` and `10 Uhr` |
| `no-provider-pii.json` | Raw sentence, plate, and VIN stay inside the process |

### Backend E2E

- [ ] Slice 2 loads the corpus through `buildProposal` and `propose_expect`. `POST /propose` is not registered in this slice. The test does not call `submitPendingAction` and does not require the policy row.
- [ ] Slice 2 covers a clarification follow-up that reuses `command_id` and adds a selection, `SELECTION_NOT_OFFERED` when a selection is outside `offered_choices`, and `COMMAND_ID_REUSED` when tokens differ.
- [ ] AUT-535 registers `POST /propose`. The canonical `propose_persist_expect` asserts HTTP 201 plus `pending_action_id` and `trace_id`. A second propose with the same tokens and selections returns HTTP 200 and those same ids, and does not insert a second row. A propose after `EXPIRED` or `REJECTED` returns 409.
- [ ] AUT-535 covers `deleteCommandReplays` on apply, reject, executor failure, and both expire paths, plus the hourly `workshop-command-session-purge` sweep that bounds a tenant whose advisor stops using the command box. It also covers REST 422 when the policy row is missing or disabled, 422 `AGENT_POLICY_LOOSER_THAN_PLATFORM` on an `AUTO` upsert, 403 for `SALES`, `LOANER_NOT_PERMITTED` on interpret for `SALES`, 409 `PLAN_STALE` when a live labor rate or a midnight boundary moves the reviewed plan, and a loaner conflict that rolls back the order.
- [ ] After slice 3, the happy path loads `canonical-huber-golf.json` and asserts no domain row exists before Apply.

Existing tests `GlobalSearch.navigation.test.tsx` and `agent-proposal-submission.service.spec.ts` stay the regression baseline. They do not prove this feature.

### Frontend

- [ ] AUT-542 visual QA: interpret, answer one clarification, Apply, see the linked order. Navigation search still opens customers and vehicles.

---

## Implementation slices

| Slice | Issue | Delivers |
| --- | --- | --- |
| 1 | AUT-515 | This spec and the fixtures |
| 2 | A new Linear issue that does not exist yet. The implementer creates it and marks AUT-542 blocked by it. This spec does not create the issue | Interpreter module, session table, `agent_proposals.command_id`, `deleteCommandReplays`, the expiry purge, and `POST /interpret`. `buildProposal` is a function, not a route. Corpus `propose_expect` has no pending ids. Deletion-policy row and tenant-restore SQL for the session table and `command_id` |
| 3 | AUT-535 | Policy seed, executor, `POST /propose` persisted through `submitPendingAction`, idempotent return of a `PENDING` row, `deleteCommandReplays` on apply, reject, executor failure, and expire, plus the hourly `workshop-command-session-purge` retention sweep. Site capture and apply-site check for `workshop.booking_package`. Fail closed when position lines are present |
| 4 | AUT-540 | Preset table, position lines, deletion-policy row, tenant-restore SQL, reservation through the parts service |
| 5 | AUT-542 | Cmd+K preview and the existing advisor voice route only. It calls the slice-2 interpret endpoint and the slice-3 propose endpoint, and it does not own the interpreter. It stays blocked by the new interpreter issue as well as AUT-535 and AUT-540 |

Slice 2 can prove the corpus, including the canonical proposal body, before slice 3. Slice 3 is what first persists an `AgentProposal`. After slice 3, apply of a non-empty plan before slice 4 returns `POSITION_PLAN_EXECUTOR_REQUIRED`.

---

## Open Questions

No product question is left open for v1. These decisions are closed:

1. The local interpreter is the shipping path. A provider adapter is specified only as a redacted token contract and is not called.
2. One singleton eligible resource is bound and shown. Two resources are a choice.
3. A non-empty position plan is part of the same proposal. Apply refuses the whole package until the position executor exists.
4. Document review follows the project workflow. This spec does not request a new external legal or tax approval.
5. `ADVISOR` is not added as a tenant role. Propose and apply stay with `OWNER` and `ADMIN`.
6. The interpreter Linear issue is created by the implementer of slice 2, and AUT-542 is then marked blocked by it. This document does not open that issue.

---

## References

- [`pending-actions.md`](pending-actions.md)
- [`decision-adapter.md`](decision-adapter.md)
- [`../Workshop/loaner-vehicles.md`](../Workshop/loaner-vehicles.md)
- [`../Workshop/customer-communication-and-approvals.md`](../Workshop/customer-communication-and-approvals.md)
- [`../Workshop/workshop-order-lifecycle.md`](../Workshop/workshop-order-lifecycle.md)
- `apps/core-web/src/components/GlobalSearch.tsx`
- `apps/core-api/src/mcp/mcp-tool-schemas.ts`
- `apps/core-api/src/pending-action-executor/pending-action-executor.service.ts`
- `apps/core-api/src/decision/decision.constants.ts`
- `apps/core-api/src/workshop/workshop-schedule.service.ts`
- `apps/core-api/src/site/site-context.service.ts`
- `apps/core-api/src/agent-policy/agent-policy-floor.ts`

---

## Linear Tracking

| Field | Value |
| --- | --- |
| Project | [Agent-era foundation](https://linear.app/auto-core-platform/issue/AUT-515) |
| Milestone | Command-first workflows and decision inbox |
| Issues | AUT-515. Follow-ups: a new interpreter issue, AUT-535, AUT-540, AUT-542. AUT-395 is not a blocker |
