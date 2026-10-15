---
title: "AT settlement and one RKSV provider"
date: "2026-10-15"
module: "Finance"
status: draft
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
linear-milestone: "AT fiscal settlement and export hardening"
tags:
  - feature-spec
  - finance
  - rksv
---

# AT settlement and one RKSV provider

## Summary

One human records a full on-site cash or card settlement of one already issued workshop invoice. That payment is not the invoice, and the fiskaly signature is not the payment. ACP asks fiskaly SIGN AT `1.2.6` to sign one receipt for that payment, stores the provider result, and only then marks the invoice `PAID`. A timeout keeps the same provider receipt id and reconciles it. A retry never signs a second time. The ACP fiscal path stays off until a person sets the legal entity to the fiskaly path or to an external cash register. AUT-363 stays cancelled. No workshop interview is added.

Checked against commit `253c400cffa1d9c866891f2cee2e59b310cd3c5b`. Synthetic requests and responses are in [at-settlement-rksv.fixtures.json](./at-settlement-rksv.fixtures.json). The only customer label is `pilot customer`. This document is the AUT-522 deliverable. It does not call fiskaly and it does not add product code.

---

## User Stories

- As an **OWNER or ADMIN** at the invoice site, I want to record that the customer paid this issued workshop invoice in full, in cash or by card at the counter, so that the open amount and the fiscal receipt are separate facts.
- As that **same person**, I want a refused or unknown signature to leave the invoice unpaid, so that a timeout cannot be “fixed” by signing again.
- As an **OWNER or ADMIN**, I want `OFF` and `UNKNOWN` to do nothing fiscal, and `REQUIRED_EXTERNAL_KASSE` to store the receipt number from the workshop’s own register, so that ACP does not pretend to be a Registrierkasse.

### Journey

1. The workshop invoice is already `ISSUED` for this site. Issuing it did not create a payment.
2. The person opens the invoice. The active site is that invoice’s site. The top-right action is `Record settlement`.
3. The amount and currency are the invoice gross in EUR. The person chooses Cash or Card and confirms once.
4. When the legal entity is `REQUIRED_ACP_RKSV` and the site has an initialized fiskaly register, ACP allocates one receipt id, sends one SIGN AT sign call, and shows the stored receipt number, signature time, register serial, and QR payload.
5. When the call times out, or the process stops after the payment row is stored and before a provider result is stored, the screen shows that state and a `Reconcile` action. Reconcile reads the receipt id already stored on that row.
6. When the legal entity is `REQUIRED_EXTERNAL_KASSE`, the person types the external receipt number and date. ACP stores them and does not call a provider.
7. A mistaken fiscal receipt is reversed by a separate confirmation that signs one cancellation receipt. The original receipt stays. The commercial invoice lines stay.

---

## Verified current behavior

| Fact | Where it lives |
|---|---|
| `InvoiceStatus` is `DRAFT`, `FINALIZED`, `ISSUED`, `PAID`, `CANCELLED`. There is no `Payment`, cash-register, or fiscal-receipt model. | `apps/core-api/prisma/schema.prisma` |
| Workshop issue moves the invoice `DRAFT` → `ISSUED`, assigns the number, writes snapshot v2, and moves the workshop order `COMPLETED` → `INVOICED`. It does not write `PAID`. | `executeIssueInvoice` in `invoice-issue.helpers.ts` |
| Sales finalization writes `FINALIZED`. Vehicle-sale finalization writes `FINALIZED`. Neither writes `PAID`. | `sales.controller.ts` `PUT invoices/:id/finalize`, `vehicle-sale.finalize.ts` |
| `InvoiceStatus.PAID` is read by PDF generation, snapshot resolution, credit-note eligibility, workshop KPIs, and accounting-export scope. The sales invoice services do not set it. `PurchaseInvoiceStatus.PAID` is a different enum and a different document. | `invoice-pdf.generation.ts`, `credit-notes.service.ts`, `accounting-export-candidates.ts`, `purchase-invoice-lifecycle.service.ts` |
| Issue loads the invoice by `tenant_id` from `TenantContextService` inside `prisma.$transaction`. Draft creation also takes the active site from `SiteContextService`. | `invoice-workshop-service.commands.ts`, `invoice-service-scope.helpers.ts` |
| A missing active site is `422` `ACTIVE_SITE_REQUIRED`. The global filter drops `code` unless the code is in `CLIENT_SAFE_HTTP_ERROR_CODES`. `ACTIVE_SITE_REQUIRED` and `FISCAL_PERIOD_LOCKED` are not in that set today. | `site-context.service.ts`, `global-exception.filter.ts`, `client-safe-http-error-codes.ts` |
| Credit commands require `OWNER` or `ADMIN` and then site access. The refusal message is `Tenant admin access is required.` | `credit-notes.service.ts` `assertCreditAccess` |
| Fiscal lock is `lockFinanceSettingsAndAssertOpen`: one `FOR UPDATE` on `finance_settings` for the tenant, then reject a date on or before `lock_date` with `FISCAL_PERIOD_LOCKED`. | `fiscal-lock.helpers.ts` |
| Status changes that must not race use `guardedStatusUpdate` (`updateMany` where id, tenant, and current status). | `status-transition.ts`, used by `executeIssueInvoice` |
| `isHumanOnlyFloorAction` forces `HUMAN_ONLY` for `invoice.finalize`, the whole `credit_note.` prefix, and the other listed floors. A tenant rule cannot loosen the floor. | `agent-policy-floor.ts`, `agent-policy.evaluator.ts` |
| MCP has no payment or finalize tool. `invoice.finalize`, `invoice.cancel`, `invoice.send`, and the credit-note actions are in `MCP_NEVER_EXPOSED_ACTIONS` (19 entries). Capabilities copy that set into `human_only_actions`. | `mcp.constants.ts`, `mcp.constants.spec.ts`, `mcp-capabilities.service.ts` |
| `AgentProposal` is the only proposal queue. Payment and signature are not action types on it. | `schema.prisma` `AgentProposal` |
| `Invoice.currency` is an optional string defaulting to `EUR`. New legal invoices are EUR. Money columns are `Decimal(10, 2)`. | `schema.prisma`, [[legal-invoicing-and-credit-notes]] |
| Dashboard realtime allowlists model names. `CREDIT_NOTE` is included. A payment model would not emit until it is added. | `prisma-dashboard-realtime.extension.ts` |
| Catalog settings store `*_credentials_secret_ref`. `catalog-provider-settings.service.ts` and `mcp-settings-read.mapper.ts` read those strings and expose booleans. They do not resolve secret material. | `catalog-provider-settings.service.ts`, `mcp-settings-read.mapper.ts` |
| AUT-363 is cancelled. `REQUIRED_EXTERNAL_KASSE` is not in product code. `UNKNOWN` already appears, for example as `UNKNOWN_TARIFF_VERSION`. The fiscal-mode enum is absent. | Linear AUT-363, `nova-calculator/types.ts` |

Issuing an invoice or completing an order is not a payment. `PAID` on a sales invoice means a settlement in this spec has fully covered the gross. It does not mean the workshop order was invoiced, and it does not mean a signature exists.

---

## Decisions

No separate ADR. Tenancy, the invoice snapshot, the credit-note document, and the `HUMAN_ONLY` floor stay as they are. This slice adds one provider and one settlement case. AUT-532 implements it. AUT-363 is not reopened.

1. The only settlement case is a full EUR settlement of one workshop invoice in `ISSUED`, with snapshot v2, `tax_mode` `STANDARD`, every line tax rate `20.00`, and no sales-order or vehicle-sale link. The person chooses Cash or Card. Cash is fiskaly `CASH`. Card is fiskaly `NON_CASH`. The amount is the invoice `total_gross`. There is no conversion.
2. The only signing provider is fiskaly SIGN AT `1.2.6`, base URL `https://rksv.fiskaly.com`, schema `standard_v1`. fiskaltrust is not integrated. The fiskaly unified API dated `2026-06-01` is not integrated.
3. Four states stay separate: payment, invoice status, ACP fiscal receipt, and the stored provider response. `REQUIRED_ACP_RKSV` moves the invoice to `PAID` only after a stored provider `200` for that receipt id. `REQUIRED_EXTERNAL_KASSE` moves it to `PAID` when the external receipt number and date are stored. Neither path changes invoice lines or workshop-order status.
4. The provider retry key is the receipt UUID in the sign URL plus the identical JSON body. ACP allocates that UUID once, freezes the body, and never allocates another for the same attempt, including a cancellation and a `PENDING` row left by a crash before the provider call returns. Replay of an ACP idempotency key returns the same payment. Reconcile reads that receipt id before any new sign.
5. Legal-entity `rksv_mode` defaults to `OFF`. `OFF` and `UNKNOWN` reject the settlement command. `UNKNOWN` is a stored label, not an interview and not a queue of workshops to classify.
6. The floor gains the prefixes `payment.` and `fiscal_receipt.`, plus the concrete actions `payment.record`, `fiscal_receipt.sign`, and `fiscal_receipt.cancel`. Those three strings are also never-exposed MCP actions. They are not `AgentProposal` types. `HUMAN_ONLY` is not treated as `PROPOSE`.

### Why this provider

| Option | Retrieved 2026-10-15 | Result |
|---|---|---|
| fiskaly SIGN AT `1.2.6` | OpenAPI `https://workspace.fiskaly.com/specs/spec-sign-at.json`. Human page `https://workspace.fiskaly.com/api/rksv/v1/operations/signreceipt/`. Quickstart `https://workspace.fiskaly.com/countries/austria/quickstart/`. | Chosen. Version, auth, sign URL, receipt fields, and same-body retry are public. |
| `https://developer.fiskaly.com/api/rksv/v1` | The page says the documentation is outdated and points to `workspace.fiskaly.com`. | Cited by AUT-522. Not used as the contract. |
| fiskaly SIGN AT unified `2026-06-01` | `https://workspace.fiskaly.com/api/sign-at/2026-06-01/` uses `X-Api-Version` and `X-Idempotency-Key`. | A second contract. Not this slice. |
| fiskaltrust RKSV.Sign | `https://docs.fiskaltrust.eu/docs/posdealers/buy-resell/products/signing/rksv` describes dealer entitlements and `POST https://helipad-sandbox.fiskaltrust.cloud/api/configuration`. It points new implementations at Middleware. The day-to-day sign schema is not on that page. | Not chosen. |

### Why this case

On-site cash and card are the Barumsatz case named in the cancelled AUT-363 note. Bank transfer, deposits, partial payments, counter sales without an invoice, sales-order invoices, and vehicle-sale invoices are a different case. Commercial credit notes stay the existing credit-note aggregate. A fiscal cancellation does not create one.

---

## Scope

In scope: the state model, the one sign/retrieve/cancel contract, idempotency, timeout reconciliation, the legal-entity mode, the minimal invoice action, and the fixture file.

Out of scope: a full POS, a second provider, a live payment or a live fiskaly call, cash-drawer counting, partial or mixed tenders, bank transfer, FX, DEP7 export scheduling, SCU and cash-register creation inside ACP, monthly and yearly close receipts, training receipts, printing a new Rechnung PDF, and reopening AUT-363 or any other cancelled human gate.

### Mode behavior

`rksv_mode` is stored on `LegalEntity`. Default `OFF`. An OWNER or ADMIN changes it in legal-entity settings. Saving `UNKNOWN` or `REQUIRED_EXTERNAL_KASSE` does not start a questionnaire.

| Mode | Settlement command |
|---|---|
| `OFF` | `422` `FISCAL_PATH_DISABLED`. No payment row. No HTTP. |
| `UNKNOWN` | Same refusal as `OFF`. The stored value is visible on the legal entity. No interview task is created. |
| `REQUIRED_EXTERNAL_KASSE` | Human enters `external_receipt_number` (1–40 characters) and `external_receipt_date`. ACP stores the payment as `SETTLED_EXTERNAL` and sets the invoice `PAID` in that transaction. No provider call and no ACP signature. |
| `REQUIRED_ACP_RKSV` | The site must already have a fiscal-register row whose cached provider state is `INITIALIZED`. Otherwise `422` `FISCAL_REGISTER_MISSING` and no payment row. A present row uses the contract below. |

`REQUIRED_ACP_RKSV` does not mean a Steuerberater has approved the workshop. It means an OWNER or ADMIN turned on this path and stored a register id. Sandbox credentials and a real initialized register are live-test prerequisites for AUT-532. They are not a legal or tax approval, and this spec does not record one.

---

## Provider contract

Sources retrieved 2026-10-15:

- OpenAPI 3.0.3, title `fiskaly SIGN AT`, version `1.2.6`, server `https://rksv.fiskaly.com`: `https://workspace.fiskaly.com/specs/spec-sign-at.json`
- Sign and retrieve narrative: `https://workspace.fiskaly.com/api/rksv/v1/operations/signreceipt/`
- Austria quickstart, including `POST https://rksv.fiskaly.com/api/v1/auth` and the sign example: `https://workspace.fiskaly.com/countries/austria/quickstart/`
- Idempotency, cancellation, outage, and schema names: `https://workspace.fiskaly.com/countries/austria/faq/`
- Receipt printing fields: the same FAQ and `https://developer.fiskaly.com/sign-at/receipt_data` (still served; the API reference beside it is the outdated page)

### Auth

`POST /api/v1/auth` with exactly one of `{api_key, api_secret}` or `{refresh_token}`. Success is `AuthenticationResponse`: `access_token` is required; the response also carries `access_token_expires_in`, `access_token_expires_at`, `refresh_token`, `refresh_token_expires_in`, and `refresh_token_expires_at`. Later calls send `Authorization: Bearer <access_token>` (`securitySchemes.JWT`).

A `401` on sign or retrieve refreshes with `{refresh_token}` and then repeats the original sign or retrieve. The receipt id does not change. If refresh returns `401` `E_AUTHENTICATION_ERROR` or `E_CLIENT_ERROR` (changelog `1.2.3`), the client authenticates with the API key and secret and then repeats the same receipt call. Failure to authenticate leaves the attempt unchanged and shows the failure. It does not allocate a receipt id.

The grouped guide at `https://workspace.fiskaly.com/reference/authentication/` (retrieved 2026-10-15) puts SIGN AT with SIGN DE and shows `access_token_expires_in` `86400` and `refresh_token_expires_in` `172800`, while its sample URL is the German middleware. In the SIGN AT 1.2.6 schema those two fields are integers with no example and no default. AUT-532 reads the SIGN AT response fields. It does not hard-code the guide numbers, and it does not call `https://kassensichv-middleware.fiskaly.com`.

Tokens stay in process memory. API key and secret are not columns, not logs, and not fixture files that ship as real credentials. The register row stores `credentials_secret_ref`, an opaque string, on the same pattern as catalog settings. The catalog readers load that string only to report whether it is present. They do not resolve secret material. The live adapter is constructed only when a resolver is supplied to it. CI uses the fixture file and does not open a socket.

### Sign and retrieve

| Operation | Method and path | Documented responses |
|---|---|---|
| `signReceipt` | `PUT /api/v1/cash-register/{cash_register_id}/receipt/{receipt_id}` | `200` `SignReceiptResponse`, `404` `NotFoundErrorResponse` |
| `retrieveReceipt` | `GET /api/v1/cash-register/{cash_register_id}/receipt/{receipt_id_or_number}` | `200` `ReceiptResponse`, `404` `NotFoundErrorResponse` |

`receipt_id` is a UUIDv4. `receipt_type` for this slice is `NORMAL` or `CANCELLATION`. `TRAINING` is not sent. `INITIALIZATION`, `DECOMMISSION`, `MONTHLY_CLOSE`, `YEARLY_CLOSE`, and `SIGNATURE_CREATION_UNIT_FAULT_CLEARANCE` are provider-generated. ACP does not create them.

The sign request `schema` is exactly one of `raw`, `standard_v1`, or `ekabs_v0`. This slice sends `standard_v1` because the OpenAPI text calls it the recommended schema and it has `payment_type`. `raw` has no payment type. `ekabs_v0` is a second document shape. The response schema is different: `SignedReceiptSchema` requires `raw` and also allows `standard_v1`. A stored `200` therefore keeps both. `ReceiptResponse`, the reconcile GET, also requires `fon_validations`. The OpenAPI text limits that FON validation to `INITIALIZATION`, `YEARLY_CLOSE`, and `DECOMMISSION`, so a `NORMAL` or `CANCELLATION` GET in this slice carries `fon_validations: []`. The example element is `{validation_result, time_validation}`.

`standard_v1` requires `amounts_per_vat_rate` and `line_items`. This slice also sends `amounts_per_payment_type`. `vat_rate` is `STANDARD`, `REDUCED_1`, `REDUCED_2`, `SPECIAL`, or `ZERO`. `payment_type` is `CASH` or `NON_CASH`. `currency_code` matches `^[A-Za-z]{3}$` and defaults to `EUR` in the schema. ACP sends `EUR`. Amounts are quoted decimals. The VAT amount pattern is `^-?\d+\.\d{2}$` on `raw` and at least two decimals on `standard_v1`. ACP sends exactly two decimals. `line_items[].text` is `Rechnung <invoice_number>` or `Storno Rechnung <invoice_number>`. Quantity is `1`. `price_per_unit` equals the signed gross.

`metadata` is at most 20 keys, key length at most 40, value length at most 500. ACP sends `acp_invoice_id`, `acp_invoice_no`, `acp_payment_id`, and on a cancellation also `acp_original_receipt_id`.

A `200` sign response requires `_id`, `_type` `RECEIPT`, `_env` `TEST` or `LIVE`, `_version`, `receipt_type`, `receipt_number`, `time_signature` (Unix seconds), `cash_register_serial_number`, `cash_register_id`, `signature_creation_unit_id`, `qr_code_data`, `signed`, and `schema` with `raw` plus the echoed `standard_v1`. `hints` may include `Sicherheitseinrichtung ausgefallen`, `Stornobuchung`, or `Trainingsbuchung`. `qr_code_data` is the RKSV QR payload and must be shown as a QR. `signed: false` is still a stored provider result: RKSV requires the text `Sicherheitseinrichtung ausgefallen` on that customer receipt. ACP does not sign again to replace it. A reconcile GET stores the same fields and `fon_validations`.

The general error object is `status_code`, `error`, `code`, `message`. `400` `E_FAILED_SCHEMA_VALIDATION` is the documented schema failure. `5xx` is temporary and may be retried with the same body after backoff. `429` uses the same backoff and the same body. Changelog `1.2.2` adds `504` for FON timeouts on SCU and cash-register state changes, where FON may or may not have applied the change. That note is about those PATCH calls, not about `signReceipt`.

### Idempotency, chain, timeout

The introduction states that the same sign request body can be sent again and the receipt is signed only once. The support article repeats that (18 November 2022, still the FAQ text). The provider retry key is therefore `receipt_id` plus that body. There is no `X-Idempotency-Key` on this v1 API. That header belongs to the unified API this slice does not use.

Cryptographic chaining is done by the cash register resource (“managing the DEP7 and recording of receipts … cryptographic chaining”). ACP does not send a previous signature. ACP takes a row lock on the site’s fiscal-register row for the whole allocate-and-send or reconcile step so two settlements on that register are not in flight together. Whether fiskaly itself serializes concurrent sign calls is not stated in the retrieved OpenAPI. The row lock is ACP’s rule so one payment still has one receipt id.

The allocate transaction commits the payment and the fiscal receipt as `PENDING`, with the receipt id and the frozen body, before the provider call. A crash in that window leaves `PENDING`. It does not leave the invoice unsigned forever, and it does not allow a second settlement. `POST /api/invoices/:id/settlement/reconcile` is the way out for both `PENDING` and `UNKNOWN`. Reconcile always `GET`s the stored receipt id first.

Timeout and any `5xx`, `408`, or lost connection after the PUT has been sent: payment and fiscal receipt become `UNKNOWN`, invoice stays `ISSUED`. The same GET table applies. A GET failure leaves the row in the state it already had (`PENDING` stays `PENDING`, `UNKNOWN` stays `UNKNOWN`).

| GET result | Next step |
|---|---|
| `200` | Store that body, including `schema.raw` and `fon_validations`. Do not PUT. Apply the `SIGNED` transition. |
| `404` with `E_RECEIPT_NOT_FOUND` | The receipt was not stored. PUT the frozen body to the same receipt id. |
| `404` with `E_CASH_REGISTER_NOT_FOUND` | Stay in `PENDING` or `UNKNOWN`. Do not allocate a new receipt id. A person repairs the register binding. |
| Timeout or `5xx` | Stay in the current state. Reconcile again later. |

A definite `400` stores `REJECTED` and does not allocate a new receipt id. A corrected settlement is a new ACP command only when no `PENDING`, `UNKNOWN`, `SIGNED`, or `SETTLED` attempt is still open. The HTTP status for “same receipt id, different body” is not in the `signReceipt` response list. ACP never sends a different body for an existing receipt id. That status stays open; see Open items.

The outage FAQ also says to keep the receipt UUID and, if a customer receipt must be handed over before the service returns, to print `Sicherheitseinrichtung ausgefallen` and replay later (`Nacherfassung`). This slice does not hand over a substitute print before the provider responds. The person waits, or leaves the payment `PENDING` or `UNKNOWN` and reconciles. The invoice is not marked paid in between.

### Cancellation

The FAQ states receipts have no cancel state. A mistake is a new receipt with `receipt_type` `CANCELLATION` and the gross amounts negated (their example: `500` corrected by `-500`). ACP does that once, on the same payment row, with one new receipt id, the same register, the same payment type, and the negated `120.00` in the fixture. Metadata `acp_payment_id` is that payment. The original provider receipt is not PATCHed. `hints` may contain `Stornobuchung`. The payment stays `SETTLED` and the invoice stays `PAID` until the cancellation `200` is stored; only then does the payment become `REVERSED` and the invoice `ISSUED`.

Cancellation is refused while the original attempt is `PENDING` or `UNKNOWN` (`422` `FISCAL_RECEIPT_UNKNOWN`). If a cancellation row for that payment is already `PENDING`, `UNKNOWN`, or `SIGNED`, another idempotency key returns `409` `CANCELLATION_ALREADY_OPEN` and does not allocate a receipt id. The same idempotency key returns that row. While it is `PENDING` or `UNKNOWN`, reconcile uses the cancellation receipt id and the same GET-then-same-body rule. A cancellation PUT that times out does not get a second receipt id. Cancellation does not call the credit-note service and does not insert a second payment.

### VAT container

OpenAPI names the containers and does not publish percents. The fiskaly article of 25 March 2026 says a 4.9% rate maps to `Betrag-Satz-Besonders` / Special and that a 19% amount can share that container; it also says the statute was still expected. That article is not the mapping for this slice.

This slice sends `vat_rate` `STANDARD` only when every snapshot line has tax rate `20.00` and the gross sum equals `total_gross`. Any other rate, including 10, 13, 0, 19, and 4.9, is `422` `VAT_CONTAINER_UNSUPPORTED`. No second container is sent.

---

## State

### Payment

`PENDING` means the row and the frozen sign body exist and no provider outcome is stored yet. The provider call happens after that transaction commits.

| From | To | When |
|---|---|---|
| — | `PENDING` | `REQUIRED_ACP_RKSV` command accepted, receipt id allocated, body frozen |
| `PENDING` | `SETTLED` | Reconcile GET `200`, or GET `404` `E_RECEIPT_NOT_FOUND` followed by the same-body PUT `200` |
| `PENDING` | `UNKNOWN` | The PUT was sent and then timed out, returned `408` or `5xx`, or the connection was lost |
| `UNKNOWN` | `SETTLED` | Reconcile GET `200`, or GET `404` `E_RECEIPT_NOT_FOUND` followed by the same-body PUT `200` |
| `PENDING` or `UNKNOWN` | `REJECTED` | Definite `400` |
| `SETTLED` | `REVERSED` | The one cancellation receipt is stored with `200`. The payment id does not change |
| — | `SETTLED_EXTERNAL` | `REQUIRED_EXTERNAL_KASSE` number and date stored |

`REJECTED` does not set `PAID`. A new settlement command may start only when the invoice is `ISSUED` and no payment is `PENDING`, `UNKNOWN`, `SETTLED`, or `SETTLED_EXTERNAL`. `PENDING` is unfinished, not abandoned: reconcile it. Do not delete it and do not open a second payment beside it.

### Invoice

The only new transitions are `ISSUED` → `PAID` and, after the single settlement is reversed, `PAID` → `ISSUED`. Both go through `guardedStatusUpdate` in the same transaction that stores the payment outcome. `DRAFT`, `FINALIZED`, `CANCELLED`, and a `PAID` invoice with a different history are `422` `SETTLEMENT_NOT_IN_SLICE`. Workshop order status stays `INVOICED`.

### Fiscal receipt

One row per provider receipt id. States: `PENDING`, `UNKNOWN`, `SIGNED`, `REJECTED`. `SIGNED` stores the provider JSON, including `schema.raw` and, on a GET, `fon_validations`, plus `receipt_number`, `time_signature`, `cash_register_serial_number`, `qr_code_data`, `signed`, `hints`, `_env`, `_version`, and the response `request-id`. The request body is immutable. A cancellation is a second fiscal-receipt row on the same `payment_id`, with `original_fiscal_receipt_id` set. The first row stays `SIGNED`. At most one cancellation row exists for that payment.

### Provider state

Provider state is the stored HTTP result, not an ACP enum that replaces the fiscal receipt. ACP does not invent `ACCEPTED` on top of a missing body. `200` with `signed: false` is still stored and still blocks a second sign.

---

## Database Impact

### New Tables / Columns

Names are the persisted names AUT-532 should migrate. New tables have UUID `id`, `tenant_id`, `createdAt`, and `updatedAt` unless noted. Every read and write includes `tenant_id` from the auth context. Money is `Decimal(10, 2)`. Dates that are calendar dates use `@db.Date`.

| Table | Column | Type | Nullable | Notes |
|---|---|---|---|---|
| `legal_entities` | `rksv_mode` | Enum `OFF`, `UNKNOWN`, `REQUIRED_EXTERNAL_KASSE`, `REQUIRED_ACP_RKSV` | No | Default `OFF` |
| `fiscal_registers` | `legal_entity_id`, `site_id` | UUID | No | Composite tenant FKs, `onDelete: Restrict`. Unique `(tenant_id, site_id)` |
| `fiscal_registers` | `provider` | String | No | Constant `FISKALY_SIGN_AT_1_2_6` |
| `fiscal_registers` | `env` | Enum `TEST`, `LIVE` | No | Must match provider `_env` on a stored receipt |
| `fiscal_registers` | `provider_cash_register_id`, `provider_scu_id` | UUID | No | Ids already created in fiskaly. ACP does not create them in this slice |
| `fiscal_registers` | `provider_state` | String | No | Cached fiskaly state. Settlement requires `INITIALIZED` |
| `fiscal_registers` | `credentials_secret_ref` | String | Yes | Opaque ref. Never the key or secret |
| `payments` | `invoice_id`, `site_id`, `legal_entity_id` | UUID | No | Must equal the invoice’s tenant, site, and legal entity |
| `payments` | `status` | Enum above | No | |
| `payments` | `method` | Enum `CASH`, `CARD` | No | Card maps to provider `NON_CASH` only on the ACP path |
| `payments` | `amount`, `currency` | Decimal(10, 2), String | No | Currency `EUR`. No conversion column |
| `payments` | `idempotency_key`, `request_hash` | String | No | Unique `(tenant_id, idempotency_key)`. Mismatch is `409` |
| `payments` | `external_receipt_number`, `external_receipt_date` | String, Date | Until external settle | Required together for `SETTLED_EXTERNAL`, otherwise null |
| `fiscal_receipts` | `payment_id`, `fiscal_register_id` | UUID | No | |
| `fiscal_receipts` | `provider_receipt_id` | UUID | No | Unique `(tenant_id, provider_receipt_id)`. The provider retry key |
| `fiscal_receipts` | `receipt_type` | Enum `NORMAL`, `CANCELLATION` | No | |
| `fiscal_receipts` | `state` | Enum above | No | |
| `fiscal_receipts` | `request_body` | Json | No | Frozen before the first send |
| `fiscal_receipts` | `response_body` | Json | Yes | Null until a body is stored |
| `fiscal_receipts` | `original_fiscal_receipt_id` | UUID | Yes | Set only on `CANCELLATION` |

Index `(tenant_id, invoice_id, status)` on payments and `(tenant_id, fiscal_register_id, createdAt)` on fiscal receipts. `createdAt` is the Prisma field on the new tables, the same name used on `AgentProposal`. Fiscal receipts have no `site_id` column; the site is the register’s site. No per-row query inside a loop: one invoice read, one register read, one payment write.

### Modified Tables

| Table | Change | Migration Required? |
|---|---|---|
| `LegalEntity` | `rksv_mode` default `OFF` | Yes, additive |
| `Invoice` | No new column. `ISSUED` ↔ `PAID` only through the guarded transitions above | No |
| `InvoiceSequence`, `CreditNote` | Unchanged | No |

`docs/deletion-policy.md` is updated in the AUT-532 migration PR, when the tables exist. The rules are below.

### Deletion Policy Impact

| Entity | Rule |
|---|---|
| `Payment` | No hard delete. Status transitions only. Tenant purge may remove it with the tenant. |
| `FiscalReceipt` | No hard delete and no update of `request_body` or a stored `response_body`. |
| `FiscalRegister` | No hard delete. Decommission in fiskaly is a later slice. |
| `LegalEntity` | Also block hard delete while a payment, fiscal receipt, or fiscal register references it. |

Realtime: add `PAYMENT` and `FISCAL_RECEIPT` to `SUPPORTED_ENTITY_TYPES` and to `dashboard-entity-map.ts`. Emit to the invoice’s site room. Payloads are ids and statuses, not QR payloads, not secret refs, and not provider bodies.

---

## API Contract Changes

Tenant comes from the auth context. The invoice is loaded with `tenant_id` and `site_id` equal to the active site from `SiteContextService`. A different site, or another tenant, is `404`. The client does not send tenant, site, or legal entity. Role is `OWNER` or `ADMIN`; anyone else gets `403` with `Tenant admin access is required.` Settlement date passes `lockFinanceSettingsAndAssertOpen`. A date on or before `lock_date` is `422`. Implementation adds every new code below to `CLIENT_SAFE_HTTP_ERROR_CODES`, and adds `FISCAL_PERIOD_LOCKED`, or the filter will omit `code`.

`idempotencyKey` is a UUIDv4 in the body, same idea as credit-note finalize. The server stores it with a hash of the command (invoice id, method, amount, currency, mode). The same key and hash return the current payment, and if a sign is still unfinished they replay the frozen provider body. The same key and a different hash is `409` `IDEMPOTENCY_MISMATCH`. The provider receipt id is server-generated and is not the idempotency key.

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|---|---|---|---|---|
| POST | `/api/invoices/:id/settlement` | `{idempotencyKey, method:"CASH"\|"CARD", externalReceiptNumber?, externalReceiptDate?}` | Payment, invoice status, and fiscal receipt summary | OWNER/ADMIN, active site is the invoice site |
| POST | `/api/invoices/:id/settlement/reconcile` | `{idempotencyKey}` of the open `PENDING` or `UNKNOWN` attempt | Same shape after GET, then the same-body PUT only when GET is `404` `E_RECEIPT_NOT_FOUND` | Same |
| POST | `/api/fiscal-receipts/:id/cancellation` | `{idempotencyKey}` | One cancellation on that payment. `409` `CANCELLATION_ALREADY_OPEN` when a cancellation row is already `PENDING`, `UNKNOWN`, or `SIGNED` | Same, on the receipt’s site |
| GET | `/api/invoices/:id/settlement` | — | The payment and receipt summaries for that invoice | Same |

External number and date are required when mode is `REQUIRED_EXTERNAL_KASSE` and forbidden otherwise (`422` `SETTLEMENT_NOT_IN_SLICE`). Amount and currency are not in the body. The server uses `total_gross` and `EUR`. A non-EUR or null `invoice.currency` is `422` `CURRENCY_UNSUPPORTED`. A gross that is not the full `total_gross` cannot be submitted, because the client does not send an amount. A snapshot that does not add up to `total_gross` is `422` `SETTLEMENT_AMOUNT_MISMATCH` and creates no payment.

Provider HTTP status and provider error codes are stored on the fiscal receipt. They are not forwarded as the ACP HTTP status. ACP returns `200` with `payment.status` `UNKNOWN` or `REJECTED` after a provider failure that belongs to an attempt already stored. Validation before the attempt is the `422` and `409` and `403` and `404` cases above.

### Modified Endpoints

| Method | Route | Change Description |
|---|---|---|
| PATCH | `/api/invoices/:id/issue` | No payment and no sign. Response unchanged |
| PUT | `/api/sales/invoices/:id/finalize` | Unchanged. Still not a settlement |
| GET / PATCH | `/api/legal-entities/:id` | Read and write `rksv_mode`. OWNER/ADMIN. Default `OFF` |
| PATCH | `/api/sites/:id` | Add the fiscal-register binding to the existing site update. There is no `PUT /api/sites`. The save does not call fiskaly |

There is no MCP tool and no public-API settlement route.

### OpenAPI Regeneration

Required in AUT-532, not in this change:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

Implementation must:

- [ ] Put `Record settlement`, `Reconcile`, and `Cancel fiscal receipt` top-right. Title, invoice number, and badges stay top-left.
- [ ] Use `text-2xl font-semibold tracking-tight` and a `text-slate-500` subtitle on the invoice page, as it already does.
- [ ] Keep invoice `StatusBadge` for `ISSUED` and `PAID`. Show payment status and fiscal-receipt status as separate badges. Do not reuse invoice `PAID` to mean “signed”.
- [ ] Show amount `120.00`, currency `EUR`, and method as read-only facts plus one method choice. Do not offer a conversion field.
- [ ] Treat the command as a single confirm, like finalize. Do not autosave a settlement draft.
- [ ] On `SIGNED`, show `receipt_number`, `time_signature` formatted as `RKSV-Datum: YYYY-MM-DD HH:mm:ss` in the site timezone, `cash_register_serial_number`, and a QR rendered from `qr_code_data`. When `signed` is false or the hint is `Sicherheitseinrichtung ausgefallen`, show that text with the QR.
- [ ] On `PENDING` and on `UNKNOWN`, show `Reconcile` and that the same receipt id will be read before any sign. Disable a second `Record settlement`.
- [ ] On `OFF` and `UNKNOWN` mode, hide the action and show that the fiscal path is off. Do not link to an eligibility form.
- [ ] On `REQUIRED_EXTERNAL_KASSE`, show number and date fields and the sentence that ACP is not the Registrierkasse.
- [ ] Legal-entity `rksv_mode` uses the existing settings autosave at 750 ms. The register id fields are part of that settings form, not of the settlement command.

List pages are unchanged. Row click on invoices stays as it is.

### Real-Time Sync

- [ ] `PAYMENT` and `FISCAL_RECEIPT` are added to the Prisma allowlist and `dashboard-entity-map.ts`.
- [ ] Invoice detail refreshes payment and receipt status for the persisted site only.

---

## Component Design

| Component | Location | Purpose |
|---|---|---|
| Invoice detail action (modify) | `apps/core-web/src/pages/sales/InvoiceDetailPage.tsx` | Settlement, reconcile, cancel, badges |
| Legal entity mode (modify) | `apps/core-web/src/components/settings/LegalEntitiesSettingsTab.tsx` | `rksv_mode` and register binding |
| Settlement service (new) | `apps/core-api/src/settlement/` | Commands, lock, provider adapter. Does not duplicate invoice issue |
| Adapter (new) | `apps/core-api/src/settlement/fiskaly-sign-at.adapter.ts` | Maps the fixture contract. Live socket only with an injected secret resolver |
| Floor and MCP lists (modify) | `agent-policy-floor.ts`, `mcp.constants.ts` | Prefixes `payment.` and `fiscal_receipt.`, three named actions, no new tool |

Business rules live in the settlement service. The web app posts the command and renders the stored result. Agents do not get a second implementation.

---

## Impact Analysis

| Dimension | Required treatment |
|---|---|
| Database | Additive legal-entity enum and three tables. No invoice financial backfill |
| State machines | New payment and fiscal-receipt machines. Invoice gains only `ISSUED` ↔ `PAID` for this slice, guarded |
| Deletion | Policy rows land with the migration. No delete endpoints |
| Realtime | Site-room invalidation of invoice settlement queries |
| API | Four routes above. Generated types in AUT-532 |
| Inventory | None |
| Finance | Lock date on the settlement date. No new invoice number. Gross taken from the snapshot, not recomputed |
| UX | One confirm action. Separate badges. No interview |

---

## Testing Plan

AUT-532 uses the fixture file as the adapter’s response table. Tests must not open a network connection and must not contain a real key.

### Backend

- [ ] Adapter maps `success-normal`, `rejection-schema`, `timeout-after-possible-acceptance`, `replay-same-body`, and `cancellation` from `at-settlement-rksv.fixtures.json`.
- [ ] Timeout then GET `200` stores one fiscal receipt, including `schema.raw` and `fon_validations`, and sets `PAID` once. A second command with the same idempotency key does not PUT a new receipt id.
- [ ] A `PENDING` row with no stored provider result reconciles by GET. GET `200` marks it signed and does not PUT. GET `404` `E_RECEIPT_NOT_FOUND` PUTs the frozen body to that same receipt id. The invoice cannot stay `PENDING` with no reconcile path.
- [ ] Cancellation uses payment `…e1` only. A second idempotency key while that cancellation is `PENDING`, `UNKNOWN`, or `SIGNED` does not PUT another `CANCELLATION`. A timed-out cancellation reconciles on its one receipt id.
- [ ] `OFF` and `UNKNOWN` create no row. `REQUIRED_EXTERNAL_KASSE` creates no fiscal receipt.
- [ ] `executeIssueInvoice` still does not create a payment. Existing `invoices.service.spec.ts` expectations stay. Add one assertion there only if the test module would otherwise hide a new write.
- [ ] `MCP_NEVER_EXPOSED_ACTIONS` contains `payment.record`, `fiscal_receipt.sign`, and `fiscal_receipt.cancel` and still does not contain a settlement tool. `mcp.constants.spec.ts` length moves from 19 to 22. `test/mcp.e2e-spec.ts` still refuses human-only invoice actions and does not gain a payment tool.
- [ ] Floor tests reject a tenant `PROPOSE` or `AUTO` rule for `payment.record` and for any other `payment.` or `fiscal_receipt.` action. No `AgentProposal` row is inserted.
- [ ] `SALES` and `TECH` receive `403`. A caller whose active site is not the invoice site receives `404`.

### Frontend

- [ ] Invoice detail: confirm settlement, see `PENDING` or `UNKNOWN`, reconcile to signed, and see the invoice badge move to `PAID` only then.
- [ ] Mode `OFF` shows no settlement action. External mode stores a typed receipt number and does not show a QR.

### Live-test prerequisites

These are not CI and not this spec:

- A fiskaly TEST API key and secret for one organization, supplied through the secret ref resolver.
- A cash register already `INITIALIZED` in TEST. The quickstart says TEST FON fields are not checked against FinanzOnline. That is a fiskaly TEST behavior, not an ACP approval.
- One comparison of a TEST `200` against the fixture shape before `LIVE` is allowed. A green unit test is not that comparison.

---

## Dependent implementation

AUT-532. Order of work:

1. Migration, deletion-policy rows, realtime allowlist.
2. Failing tests from the fixture cases, then the settlement service and the fixture adapter.
3. Floor, `MCP_NEVER_EXPOSED_ACTIONS`, and the capabilities copy that already reads that list.
4. Allowlist the new error codes.
5. Routes, OpenAPI, and the invoice page.
6. Do not bind a live HTTP client in CI.

Prisma generate and `tools/tenant-restore/generate-tenant-restore-sql.mjs` run in that PR because the schema changes there. New rows are tenant-scoped and follow the tenant purge. Realtime is the site-room invalidation above. No retention shorter than the payment itself: fiscal receipts are kept with the invoice.

---

## Open items

These were checked. They are not guessed.

1. **Different body, same receipt id.** Retrieved OpenAPI lists `200` and `404` for `signReceipt`. It does not name the status when the body differs. ACP freezes the body and will not send a second one. The provider status stays unproven until a TEST call.
2. **Token durations on SIGN AT itself.** `86400` and `172800` are on the grouped authentication guide, whose sample URL is SIGN DE. The SIGN AT 1.2.6 schema types the expiry fields as integers and gives them no example and no default. The client uses the response fields.
3. **Concurrent chain inside fiskaly.** Chaining is documented as the cash register’s job. A client lock is not documented. ACP locks the register row anyway.
4. **VAT percents.** Containers have names and no percents in OpenAPI `1.2.6`. The March 2026 fiskaly article maps 4.9% to Special and mentions 19% in that same container, subject to legislation at the time of writing. This slice only sends 20.00% gross as `STANDARD`.
5. **`signReceipt` `400`.** Schema failure `E_FAILED_SCHEMA_VALIDATION` is in the general `400` section. It is not a dedicated `signReceipt` response entry. The rejection fixture uses that general object. A TEST call can confirm the status.
6. **GET `404` after timeout** is specified above and is not the timeout fixture. The fixture is the branch where the GET returns the receipt, which is the “possible acceptance” case.
7. **Secret resolver.** Catalog code already reads `*_credentials_secret_ref` and exposes a boolean. It does not resolve secret material. Live signing waits for a resolver injected into the adapter. That is a live-test prerequisite, not a second product.

---

## References

- Fixture file: [at-settlement-rksv.fixtures.json](./at-settlement-rksv.fixtures.json)
- [[legal-invoicing-and-credit-notes]]; [[2026-04-12-fiscal-lock-date]]; `docs/deletion-policy.md`
- fiskaly SIGN AT OpenAPI 1.2.6, retrieved 2026-10-15: https://workspace.fiskaly.com/specs/spec-sign-at.json
- Sign operation, retrieved 2026-10-15: https://workspace.fiskaly.com/api/rksv/v1/operations/signreceipt/
- Austria quickstart, retrieved 2026-10-15: https://workspace.fiskaly.com/countries/austria/quickstart/
- Austria FAQ (idempotency, cancellation, outage), retrieved 2026-10-15: https://workspace.fiskaly.com/countries/austria/faq/
- Authentication guide, retrieved 2026-10-15: https://workspace.fiskaly.com/reference/authentication/
- Outdated pointer named by AUT-522, retrieved 2026-10-15: https://developer.fiskaly.com/api/rksv/v1
- fiskaltrust RKSV.Sign dealer page, retrieved 2026-10-15: https://docs.fiskaltrust.eu/docs/posdealers/buy-resell/products/signing/rksv
- Receipt data fields, retrieved 2026-10-15: https://developer.fiskaly.com/sign-at/receipt_data

---

## Linear Tracking

| Field | Value |
|---|---|
| Project | Legal Invoicing & Accounting Export |
| Milestone | AT fiscal settlement and export hardening |
| Issues | AUT-522 specifies this file. AUT-532 implements it. AUT-363 stays cancelled. |
