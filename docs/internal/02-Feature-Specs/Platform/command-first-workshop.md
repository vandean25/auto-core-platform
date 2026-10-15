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

- As a **service advisor**, I want to turn one supported sentence into a preview of an existing customer, their vehicle, a site-local appointment, local presets, and an optional loaner, so that I can accept one proposal.
- As a **service advisor**, I want an exact choice when several customers, vehicles, times, or resources match, so that the system does not pick for me.
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

The interpreter clock is the API server clock, frozen in tests by the fixture field `now`. That instant is not a client field. The site IANA timezone is `Site.timezone`, read with the site row. Workshop wall-clock conversion uses the same zone as `workshop-schedule.service.ts`.

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

A follow-up `CommandInput` repeats the full text plus `selections`: an array of `{ "slot", "value" }` taken from `choices`. Selections cannot introduce a slot the clarification did not offer.

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
| `standort` plus a site code or full site name | site constraint | Compared with the operative site |

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
| 0 bays | `RESOURCE_MISSING`. The only choice is `stop` |
| 1 bay | Bind it and show it in the preview |
| 2 or more bays | `RESOURCE_AMBIGUOUS` |
| 0 loaners and loaner requested | `RESOURCE_MISSING`. Choices are `continue_without_loaner` and `stop` |
| 1 loaner | Bind it |
| 2 or more loaners | `RESOURCE_AMBIGUOUS`, plus `continue_without_loaner` |

A free bay or loaner on another site is not a choice. The code is `RESOURCE_MISSING` for the operative site, not a silent cross-site booking.

Loaner writes stay on the existing rule: tenant `OWNER` or `ADMIN`, or a linked employee with role `SERVICE_ADVISOR`. When the caller cannot write a loaner, the code is `LOANER_NOT_PERMITTED` with `continue_without_loaner` and `stop`.

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

Action key: `workshop.booking_package`. Platform policy row: tier `PROPOSE`, `enabled: false`. A tenant cannot set `AUTO`; the server clamps to `PROPOSE`, the same clamp as `workshop_order.propose_line`. While the row is missing or disabled, propose returns HTTP 403 `not_permitted` and stores nothing. The action is not an MCP free-text tool. A later typed MCP registration must use this payload and the existing write pipeline.

`HUMAN_ONLY` floor actions in `agent-policy-floor.ts` are never emitted. The never-exposed MCP actions, including `estimate.send_customer_message`, `invoice.finalize`, `invoice.send`, and `invoice.cancel`, are never emitted. Disabled and `HUMAN_ONLY` evaluations do not preview and do not execute.

If `position_plan.lines` is non-empty before the AUT-540 executor is deployed, apply returns HTTP 409 `POSITION_PLAN_EXECUTOR_REQUIRED` and creates no order and no loaner. Lines are not dropped.

Apply stores the operative `site_id` in the executor context at simulation time, as `workshop_order.create` already does. Apply re-checks policy, membership, bay occupancy, loaner overlap, and prices. Bay conflict and loaner overlap stay HTTP 409 from the domain services. Both writes roll back together.

Existing estimate send, public approval, and the communication timeline remain the advisor's next manual steps after `EXECUTED`. Start Service consumes the stored plan and must not duplicate tasks, lines, or reservations (AUT-540).

Idempotency: the same `command_id` and the same intent hash return the same pending proposal. A different body with the same `command_id` is HTTP 409 `COMMAND_ID_REUSED`.

---

## Error codes

| Code | HTTP | When |
| --- | --- | --- |
| `ACTIVE_SITE_REQUIRED` | 422 | Existing site-context failure |
| `CONTRACT_VERSION_UNSUPPORTED` | 400 | Version is not `workshop-command/v1` |
| `CONTRACT_UNKNOWN_FIELD` | 400 | Closed object rejected a field |
| `LOCALE_UNSUPPORTED` | 400 | `locale` is not `de-AT` |
| `TEXT_TOO_LONG` | 400 | Text longer than 500 characters |
| `not_permitted` | 403 | Policy off, `HUMAN_ONLY`, or caller is not OWNER, ADMIN, or ADVISOR |
| `LOANER_NOT_PERMITTED` | 200 as clarification | Loaner requested and the caller fails the loaner write rule |
| `INTENT_INCOMPLETE` | 409 | Propose called while the body is still a clarification |
| `COMMAND_ID_REUSED` | 409 | Same id, different intent hash |
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

`SITE_MISMATCH` choices are `continue_at_operative_site` and `stop`. `TIME_CONTRADICTORY` choices are the conflicting clocks. `TIME_AMBIGUOUS` choices are the two UTC instants. `CUSTOMER_NOT_FOUND` and `UNSUPPORTED_SERVICE` have empty `choices`.

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
| `agent_proposals` | `command_id` | uuid | yes | Unique `(tenant_id, command_id)`. AUT-535 |

Preset lookup prefers the operative site row and otherwise the tenant-wide row. Prices stay on `LaborOperation` and `CatalogItem`. The preset does not store a price.

### Modified Tables

| Table | Change | Migration Required? |
| --- | --- | --- |
| `agent_proposals` | Nullable `command_id` plus unique `(tenant_id, command_id)` | Yes, in AUT-535 |
| `agent_policy_rules` | Seed `workshop.booking_package` as disabled `PROPOSE` | Yes, in AUT-535 |

No change to `InventoryStock` except through `InventoryTransaction` inside `PartsRequisitionService`. No invoice table is written. `FinanceSettings.lock_date` is not involved. Workshop order numbers keep the existing singleton counter inside the intake transaction.

### Deletion Policy Impact

This spec PR does not add a table, so `docs/deletion-policy.md` stays unchanged here. The AUT-540 migration PR adds:

| Entity | Rule |
| --- | --- |
| `WorkshopCommandPreset` | Soft-disable with `active = false`. Hard delete is refused while the row is referenced by a pending `workshop.booking_package` payload. |
| `AgentProposal` | Unchanged. Retained. `command_id` does not add a delete path. |

`WorkshopOrder`, `WorkshopTask`, `WorkshopTaskLineItem`, and `LoanerBooking` keep their current deletion rules. The package does not add a cascade that deletes a customer or a vehicle.

### State

No new status values.

| Entity | Status written by Apply |
| --- | --- |
| `WorkshopOrder` | `SCHEDULED` |
| `WorkshopTask` | `NOT_STARTED` |
| `LoanerBooking` | `RESERVED` |
| `AgentProposal` | `PENDING` until Apply, then `EXECUTED` or `FAILED` |

Apply does not move the order to `INTAKE`. Existing `updateMany` status guards stay in the domain services.

### Real-time sync

Interpret is stateless and is not an entity type. `WorkshopCommandPreset` is master data and is not added to `SUPPORTED_ENTITY_TYPES`. `WorkshopOrder` and `AgentProposal` keep their current sync behavior.

---

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
| --- | --- | --- | --- | --- |
| `POST` | `/api/workshop/commands/interpret` | `CommandInput` plus optional `selections` | `WorkshopIntent` or `Clarification` | Authenticated active membership. No writes |
| `POST` | `/api/workshop/commands/propose` | The `WorkshopIntent` the server just returned, including `command_id` | `ProposalResult` | OWNER, ADMIN, or ADVISOR. Simulates and stores one proposal |

The server recomputes the intent from `command_id` replay input stored with the selection set. It does not trust client-supplied prices, ids that were not in the clarification choices, or a client-supplied site.

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

The sentence field submits on an explicit Interpret action. It is not an auto-saved entity. Clarification choices submit as `selections`. The preview is read-only until Apply.

### Real-Time Sync

- [x] No new entity type for the command.
- [x] No new dashboard query key.

---

## Component Design

| Component | Location | Purpose |
| --- | --- | --- |
| `GlobalSearch` | `apps/core-web/src/components/GlobalSearch.tsx` | Unchanged navigator. AUT-542 adds the command mode beside it |
| `WorkshopCommandPreview` | `apps/core-web/src/features/workshop-command/` | AUT-542. Renders one clarification or one `ProposalResult` |

Server module, also AUT-542's dependency, owned by the slices below:

| Module | Location | Purpose |
| --- | --- | --- |
| Local interpreter | `apps/core-api/src/workshop-command/` | Pure parse and resolve against a loaded snapshot |
| Executor branch | `pending-action-executor.service.ts` | `workshop.booking_package` only |

---

## Testing Plan

The corpus is the acceptance test. A future test loads every file in [`fixtures`](command-first-workshop/fixtures), merges `world_patch` with RFC 7396 onto [`world.json`](command-first-workshop/fixtures/world.json), and freezes `now`. A file with `cases` runs each case. When `expect.body` contains `position_plan` or `code`, it deep-equals the response body. Otherwise it is a deep subset of that body. `$anyUuid` matches any UUID. Omitted `http_status` means 200. `provider_invoked` is `false` and `outbound_bodies` is `[]`. `queries_other_site`, when present, is exact. Every string in `forbidden_substrings` is absent from `outbound_bodies`. On `canonical-huber-golf.json`, `propose_expect.body` deep-equals the proposal and its `intent` deep-equals the interpret body without `status`. `domain_rows_before_apply` is empty: no `WorkshopOrder`, `WorkshopTask`, `WorkshopTaskLineItem`, `LoanerBooking`, or `PartsReservation` exists before Apply.

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
| `wrong-site.json` | `Standort Nord` while the operative site is `WIE` |
| `contradictory-time.json` | `8 Uhr` and `10 Uhr` |
| `no-provider-pii.json` | Raw sentence, plate, and VIN stay inside the process |

### Backend E2E

- [ ] Happy-path test in `apps/core-api/test/` loads `canonical-huber-golf.json` and asserts no domain row exists before Apply.
- [ ] Error and edge fixtures above, plus 403 `not_permitted`, 409 `PLAN_STALE`, 409 `COMMAND_ID_REUSED`, and a loaner conflict that rolls back the order.

Existing tests `GlobalSearch.navigation.test.tsx` and `agent-proposal-submission.service.spec.ts` stay the regression baseline. They do not prove this feature.

### Frontend

- [ ] AUT-542 visual QA: interpret, answer one clarification, Apply, see the linked order. Navigation search still opens customers and vehicles.

---

## Implementation slices

| Slice | Issue | Delivers |
| --- | --- | --- |
| 1 | AUT-515 | This spec and the fixtures |
| 2 | AUT-535 | Policy seed, `command_id`, executor for booking and loaner, fail closed when lines are present |
| 3 | AUT-540 | Preset table, position lines, deletion-policy row, reservation through the parts service |
| 4 | AUT-542 | Interpreter module, the two endpoints, corpus tests, Cmd+K preview, voice transcript into the same input |

Slice 4 can interpret before slice 3. Propose of a non-empty plan before slice 3 stores nothing executable: apply returns `POSITION_PLAN_EXECUTOR_REQUIRED`.

---

## Open Questions

No product question is left open for v1. These decisions are closed:

1. The local interpreter is the shipping path. A provider adapter is specified only as a redacted token contract and is not called.
2. One singleton eligible resource is bound and shown. Two resources are a choice.
3. A non-empty position plan is part of the same proposal. Apply refuses the whole package until the position executor exists.
4. Document review follows the project workflow. This spec does not request a new external legal or tax approval.

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
| Issues | AUT-515. Follow-ups AUT-535, AUT-540, AUT-542. AUT-395 is not a blocker |
