---
title: "ADR-0025: Customer Communication, Estimates and Transactional Notifications"
date: "2026-10-02"
status: proposed
deciders: "Product Owner (Dejan Dosenovic — PO checkbox on AUT-353 pending)"
linear-project: "https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b"
linear-milestone: "0 — Spec & ADR"
tags:
  - adr
  - workshop
  - notifications
  - estimate
  - dsgvo
---

# ADR-0025: Customer Communication, Estimates and Transactional Notifications

## Status

**Proposed — 2026-10-02.** Implements the architecture baseline for Epic 3 (Customer Communication & Approvals). Product-owner acceptance is recorded on [AUT-353](https://linear.app/auto-core-platform/issue/AUT-353) when Dejan ticks the approval checkbox; until then, dependent implementation tickets remain blocked.

This ADR **does not** promote [ADR-0014](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) to Accepted. It **supersedes only** the outbound-customer notification wording in ADR-0014 §4.3 (pause / `WAITING_CUSTOMER`) and implementation step 9 in §13, as clarified in §6 below.

## Context

Austrian workshops need a Kostenvoranschlag (estimate), a durable approval trail, and transactional customer messages (estimate link, approval confirmation, vehicle ready) without sending marketing from Epic 3. Engineering must reuse the existing PDF pipeline (ADR-0007), document branding (ADR-0024), numbering (ADR-0009), audit (ADR-0015), tenant isolation (ADR-0013), and status guards (ADR-0011).

[ADR-0014](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) remains **Proposed** and describes a mechanic tablet program that is larger than Epic 3. Its §4.3 currently states that `WAITING_CUSTOMER` publishes a domain event for “standard outbound contact notification flow (email and/or SMS)” to the customer. Product and legal research (AUT-360, amended 2026-10-02) narrow Epic 3: estimate and ready notices are separate, feature-flagged, transactional flows; `WAITING_CUSTOMER` must **not** auto-email or auto-SMS the customer in v1.

Decisions were answered in [AUT-360](https://linear.app/auto-core-platform/issue/AUT-360) (first comment, 2026-10-02) and **amended** in the “Amendments after legal research” comment on the same issue. Where they differ, the amendments win. The feature spec [[customer-communication-and-approvals]] is the product-facing source; this ADR is the architectural contract.

## Decision Drivers

- Smallest closed loop for a small Austrian workshop: workshop order estimate → send → approve → work continues → ready notice.
- No notifications from mutation handlers; use an outbox and a dedicated sender worker (aligns with ADR-0014 intent, different customer scope).
- Expand-only database migrations; production has no staging — migrations run on the live database before new code ships.
- TECH users never send estimates, never approve on behalf of customers, never override approvals (RBAC from ADR-0014 carries forward where still applicable).
- DSGVO and Austrian consumer-law copy are **not** verified by engineering; customer link sending stays behind a feature flag until lawyer-approved text and open legal questions are resolved.

## Decision

### 1. Estimate document model (`WorkshopEstimate` / `WorkshopEstimateVersion`)

- **Scope v1:** `WorkshopOrder` only. `SalesOrder` estimates are deferred.
- **Numbering:** `KV-YYYY-XXXX` per tenant and calendar year (ADR-0009 atomic counter pattern). Revisions keep the number and increment **version** (e.g. `KV-2026-0012` v2).
- **Lifecycle (estimate-owned, not order status):** `DRAFT` → `SENT` → `APPROVED` | `DECLINED` | `EXPIRED` | `SUPERSEDED`. No new `WorkshopOrderStatus` in v1.
- **Binding:** Non-binding Kostenvoranschlag by default, free of charge, **valid 14 days** from send (`valid_until`, advisor-editable). Mandatory **B2C non-binding declaration** (KSchG § 5 Abs 2) as a code-owned, versioned, non-removable block on PDF and public approval page, directly above the action button. B2B prints the same block for simplicity. Exact German wording requires lawyer sign-off; sending to customers remains flag-gated until then.
- **Overrun:** Tenant-configurable guide threshold (default **15 %**, measured on **gross** totals vs the **approved** version — **provisional** pending D18/lawyer gross-vs-net confirmation; not statutory — § 1170a Abs 2 ABGB “beträchtlich”). When detected, persist `overrun_detected_at`, `overrun_notified_at` (+ channel, user, amount quoted, customer reaction) in the audit trail; advisor actions **Kunden informiert** and **Send revised estimate** (new version supersedes; baseline resets on approval). Invoice finalisation shows a **prominent warning** if totals exceed approved × (1 + threshold) without approved revision or notification record; hard block is an open product decision. Customer change-request extras require their own approval path.

### 2. Amendment to ADR-0007 — PDF kind `Estimate`

Add a fourth row to ADR-0007’s supported-entity table (applied in [ADR-0007](2026-04-12-async-pdf-pipeline.md) together with its §5 status-validation list and overwrite bullet):

| Entity                    | Renderable when status is                                             |
| ------------------------- | --------------------------------------------------------------------- |
| `WorkshopEstimateVersion` | `SENT`, `APPROVED`, `DECLINED`, `EXPIRED`, `SUPERSEDED` (not `DRAFT`) |

- Reuse Cloud Tasks → HMAC worker → Playwright → GCS unchanged (ADR-0007). No new PDF library.
- PDF is rendered **once** when a version is first sent and **never overwritten** (same tightening as ADR-0024 §5 for invoices).
- Reuse `pdf_storage_key`, `pdf_generated_at`, `pdf_generation_error` on the version row.
- Worker guard and frontend polling follow the existing invoice/credit-note pattern (ADR-0007 §5 retrieval).

**Retention amendment (supersedes ADR-0007 neutral bullet “retention = bucket config” for compliance records):** each sent estimate version gets `retain_until` at send time using the **never-converted** default (31 December of document calendar year + 3; lawyer to confirm — see §10). When the linked `WorkshopOrder` reaches `INVOICED`, extend `retain_until` to 31 December of (document calendar year + 7) (UGB § 212 Abs 2, BAO § 132 Abs 1). Bucket policy must be **≥ 8 years** or honour per-object `retain_until`, plus legal hold and a deletion mechanism after expiry (DSGVO Art 5(1)(e), Art 17(3)(b)). Never re-render archived PDFs; retain original bytes and SHA-256.

### 3. Amendment to ADR-0024 — branding for estimates

- Reuse `DocumentBrandProfile` **read-only** at send time: resolve the seller `LegalEntity`’s confirmed profile (or ACP default), then **freeze** tokens and immutable asset references into the estimate version snapshot (same pattern as invoice commitment).
- **No** dependency on `INVOICE_BRANDING_WRITER_ENABLED`; that flag continues to govern invoice branding writer UI only.
- Extraction stays `disabled`/manual tokens for v1. Shared helper may be extracted from invoice PDF branding helpers in AUT-354.
- Assets referenced by estimates follow invoice asset retention rules. ADR-0024 PO/accountant PDF approval gates for **invoices** are not widened to estimates in v1.

### 4. Snapshot at send

When a version transitions from `DRAFT` to `SENT`, freeze immutably:

- Line items (parts, labor), quantities, unit prices, taxes, totals (gross for B2C display per product assumption).
- Validity (`valid_from`, `valid_until`), estimate number and version, legal-text version ids.
- Seller `LegalEntity` identity fields used on the document.
- Customer name, address, vehicle identifiers, **recipient email** (from confirm dialog; may update `Customer.email`).
- Resolved branding snapshot (schema version, tokens, preset, asset refs).
- Content hash (`content_sha256`) of the canonical snapshot JSON for evidence.

Post-send order edits do **not** mutate the snapshot and do **not** by themselves block approval. Link or advisor-recorded approval returns **409** when the version is not `SENT` (already `SUPERSEDED`, `EXPIRED`, `APPROVED`, or `DECLINED`), when `valid_until` has passed, or when the approval token is invalid/consumed. Material order drift after send is handled by the overrun flow (§1), not by rejecting an otherwise valid `SENT` version.

### 5. Who may send and who may approve

| Action                                     | Roles                          | Notes                                                                                    |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------- |
| Create/edit draft estimate                 | `OWNER`, `ADMIN`, `SALES`      | On authorized workshop order                                                             |
| Send estimate / enqueue PDF + notification | `OWNER`, `ADMIN`, `SALES`      | `TECH` → 403. Requires `Customer.email` for email send unless advisor-recorded-only path |
| Advisor-recorded approval/decline          | `OWNER`, `ADMIN`, `SALES`      | Phone/in person; audit who/how/when/note                                                 |
| Customer link approval/decline             | Customer holder of valid token | POST only consumes token                                                                 |
| Override or delete approval evidence       | —                              | Forbidden                                                                                |

### 6. Notification bus and supersession of ADR-0014 customer wording

- Domain mutations **enqueue** rows on a `NotificationOutbox` (or equivalent) in the same transaction as the business state change. A separate Cloud Tasks queue and worker delivers email (v1); SMS is AUT-372.
- **No** SMTP/SMS from workshop mutation handlers.
- **ADR-0014 §4.3 / §13 step 9 (superseded for Epic 3 v1):** when a task enters `WAITING_CUSTOMER`, the platform may emit an **internal** advisor notification (in-app / realtime per ADR-0001). It must **not** automatically send customer email or SMS. Customer contact for estimates and ready-for-pickup uses the Epic 3 outbox flows only.
- **Classes:** Estimate send, approval confirmation, and ready-for-pickup messages are **transactional** service messages (Art 6(1)(b) DSGVO) only if free of promotional content. Pickerl, review, and satisfaction mail are **marketing** — owned by Epic 7 ([AUT-374](https://linear.app/auto-core-platform/issue/AUT-374)); Epic 3 sends none.
- v1 outbox status = accepted by provider; **no delivery webhooks**.
- Provider shortlist: Brevo, Scaleway TEM, Mailjet, Amazon SES `eu-central-1`. Planner default **Brevo** until [AUT-362](https://linear.app/auto-core-platform/issue/AUT-362) completes DPA review. Email body = summary + link; **no PDF attachment** in v1 (PDF via token page).

### 7. Public approval route (narrow unauthenticated surface)

- Routes: `GET/POST /api/public/estimate-approvals/:token` and frontend `/approve/:token` outside `AuthProvider`.
- Token: 32-byte CSPRNG opaque value, **SHA-256 hashed at rest**, tied to one `WorkshopEstimateVersion`.
- **Expiry:** token expires at the version’s `valid_until` (default 14 days from send), **not** a fixed 7 days. Re-send mints a new token and invalidates the previous. **View** (GET) is repeatable; only **POST** decision consumes the token (email scanner safe).
- Lookup via one narrow `system-prisma-allowlist` function, then tenant context; response projection = estimate document fields only.
- Throttle per IP and per token; generic 404/410 for invalid/expired/used; `noindex`, `no-referrer`.
- Approval page: summary/confirm step, ECG §§ 9–11 static info (workshop-supplied text), privacy-notice link, mandatory legal blocks, B2C button wording per lawyer (draft: “Kostenvoranschlag annehmen und zahlungspflichtig beauftragen” — unverified).
- **Evidence package** on link approval: `estimate_version_id`, snapshot and PDF `content_sha256`, `token_id` (not raw token), decision, `decided_at`, IP, user-agent, `accept-language`, legal-text hash/version, typed full name + checkbox, recipient email, confirmation email sent_at + provider message id, open tracking (disabled until D26 / TKG § 165 Abs 3 is cleared), channel `LINK` | `ADVISOR_RECORDED`. UI: “elektronisch bestätigt”, never “digital signiert”.
- **FAGG / distance contract:** `WorkshopOrder.intake_channel` enum `IN_PERSON` | `REMOTE_ONLY`. For B2C `REMOTE_ONLY`, enable distance-contract mode (FAGG info, withdrawal instruction, “Vertrag widerrufen” from 2026-10-01, early-start request). Customer sending stays behind feature flag until lawyer confirms scenario A.

### 8. Consent and contact (Epic 7 owns ledger)

- Epic 7 ([AUT-374](https://linear.app/auto-core-platform/issue/AUT-374)) owns `CustomerConsent` ledger (TRANSACTIONAL vs MARKETING). Epic 3 builds **no** marketing consent UI and sends **no** marketing.
- v1: `Customer.contact_email_ok` boolean NOT NULL DEFAULT false (expand-only migration). Advisor sets at intake: label **E-Mail-Adresse für Auftragskommunikation angegeben**. Epic 7 later migrates to ledger purpose TRANSACTIONAL / legal basis CONTRACT.
- SMS: AUT-372 adds E.164 and opt-out; consumes Epic 7 model when available.

### 9. Order and task coupling

- Approval does **not** auto-resume tasks in `WAITING_CUSTOMER`. Order shows derived badge (estimate sent / approved / declined). Advisor uses existing guarded **Resume waiting tasks** action.
- `WORKSHOP_ORDER_READY` event: fired once on transition to `COMPLETED`; advisor resend audited ([AUT-357](https://linear.app/auto-core-platform/issue/AUT-357)).

### 10. Retention and erasure (defaults until Epic 7 engine)

| Record                                   | Retention                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Estimate PDF + snapshot at send          | `retain_until` = 31 Dec (document year + 3) until the linked order is `INVOICED` (never-converted default; lawyer to confirm) |
| Estimate PDF + snapshot (invoiced order) | On `INVOICED`, extend `retain_until` to 31 Dec (year + 7); legal hold; restricted access after erasure request until expiry   |
| Never-converted estimates (final)        | Remain at 31 Dec (year + 3) if the order never invoices (lawyer to confirm)                                                   |
| Link-approval IP / UA                    | `approved_at` + 3 years (tenant-configurable), then null; approval row kept                                                   |
| Outbox body                              | Purge after 90 days; metadata up to 3 years                                                                                   |
| Email send metadata log                  | Up to 3 years                                                                                                                 |

### 11. Migrations

All new tables and columns are **expand-only** and backward compatible with the prior application revision. No destructive migration in the same release as code that depends on new columns. Enum additions only (no renames/removals in v1).

## Consequences

### Positive

- Reuses PDF, branding, numbering, and audit patterns; one new document kind and one public route family.
- Clear separation of transactional Epic 3 vs marketing Epic 7.
- Evidence-oriented approvals without claiming qualified signatures.

### Negative

- Public token route requires security review ([AUT-373](https://linear.app/auto-core-platform/issue/AUT-373)) and ongoing abuse monitoring.
- Overrun and FAGG rules add advisor workload and UI surface.
- Retention model is stricter than bucket-only lifecycle (operational follow-up [AUT-371](https://linear.app/auto-core-platform/issue/AUT-371)).

### Neutral

- ADR-0014 remains Proposed; mechanic tablet work may later align internal notifications with this bus.
- WhatsApp channel is out of scope.

## Alternatives Considered

| Option                                  | Pros              | Cons                                                    |
| --------------------------------------- | ----------------- | ------------------------------------------------------- |
| Reuse `WorkshopOrder` PDF as estimate   | No new entity     | Conflates job card and KV; weak versioning and approval |
| JWT in approval link                    | Stateless         | Harder revocation, larger attack surface                |
| 7-day token                             | Shorter exposure  | Conflicts with 14-day estimate validity (amended away)  |
| Separate branding archive for estimates | Isolation         | Duplicate ADR-0024 operations                           |
| Promote ADR-0014 to Accepted now        | Single tablet ADR | Scope too large; open AI-voice reviews                  |

## References

- Feature spec: [[customer-communication-and-approvals]]
- [ADR-0007](2026-04-12-async-pdf-pipeline.md) — PDF pipeline (amended §2)
- [ADR-0009](2026-04-12-sequential-document-numbering.md) — `KV-YYYY-XXXX`
- [ADR-0011](2026-04-12-atomic-status-transition-guards.md) — transition guards
- [ADR-0013](2026-04-15-row-level-multi-tenancy.md) — tenant isolation
- [ADR-0014](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) — RBAC; notification wording superseded §6
- [ADR-0015](2026-05-26-audit-tracing-and-operational-logging.md) — audit trail
- [ADR-0024](2026-09-27-legal-entity-document-branding.md) — branding (amended §3)
- `docs/internal/05-Runbooks/system-prisma-allowlist.md`
- Linear: [AUT-353](https://linear.app/auto-core-platform/issue/AUT-353), [AUT-360](https://linear.app/auto-core-platform/issue/AUT-360), [AUT-354](https://linear.app/auto-core-platform/issue/AUT-354)–[357](https://linear.app/auto-core-platform/issue/AUT-357), [AUT-372](https://linear.app/auto-core-platform/issue/AUT-372), [AUT-373](https://linear.app/auto-core-platform/issue/AUT-373), [AUT-374](https://linear.app/auto-core-platform/issue/AUT-374)

---

## Linear Tracking

| Field     | Value                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Project   | [Customer Communication & Approvals](https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b) |
| Milestone | 0 — Spec & ADR                                                                                                                        |
| Issues    | AUT-353 (this ADR), AUT-354, AUT-355, AUT-356, AUT-357, AUT-372, AUT-373; human AUT-360, AUT-362, AUT-371; Epic 7 AUT-374             |
