---
title: "ADR-0024: LegalEntity Document Branding and Letterhead Extraction"
date: "2026-09-27"
status: proposed
deciders: "Product Owner (Dejan Dosenovic); acceptance pending"
linear-project: "https://linear.app/auto-core-platform/project/legalentity-document-branding-and-letterhead-28dc131cc98c"
linear-milestone: "0 — Spec & ADR"
tags: [adr, legal-entity, branding, invoice, pdf]
---

# ADR-0024: LegalEntity Document Branding and Letterhead Extraction

## Status

**Proposed — 2026-09-27.** Product-owner review is required before acceptance. This record specifies the boundary for the subsequent Feature Spec; AUT-317 introduces no runtime schema, UI, extraction service or PDF code.

## Context

Workshops want commercial PDFs to reflect their corporate identity, often starting with an existing PDF or PNG letterhead (Briefvorlage). A tenant can contain multiple legal entities with different identities. A tenant-wide logo or an arbitrary uploaded page cannot reliably express that ownership while preserving ACP's invoice content and historical evidence.

The existing invoice PDF service resolves an invoice snapshot and passes it to its renderer. ADR-0004 establishes immutable document facts, ADR-0023 freezes seller identity at commitment, and ADR-0007 supplies an asynchronous Playwright worker and GCS archive. Branding must extend those boundaries without introducing a second rendering stack or allowing uploaded content to control invoice calculations or legal blocks.

## Decision Drivers

- Give each legal seller a recognizable letterhead with a small, supportable configuration surface.
- Preserve ACP-owned financial content, pagination and country-specific invoice rules.
- Keep extraction optional and recoverable through manual configuration.
- Preserve issued documents across profile edits, asset replacement and worker retries.
- Treat uploads and model output as untrusted data, never executable templates.

## Decision

### 1. LegalEntity owns DocumentBrandProfile

Use the name `DocumentBrandProfile` for a tenant-scoped profile belonging to exactly one `LegalEntity`. Slice 1 has at most one current profile per legal entity, with a revision identifier for concurrency and snapshot provenance. Tenant-safe ownership constraints must prevent assigning a profile or asset to another tenant's entity.

Resolve branding from the invoice's persisted legal-entity ownership established by ADR-0023, never from the current site switcher. Several sites of the same entity share its profile. Profile administration requires authorized tenant administration; document preview and download retain the document's site authorization. Knowing an entity or asset ID does not grant access. The Feature Spec must define these endpoint permissions explicitly.

No profile means the versioned ACP default appearance. This default must also be resolved and frozen on commitment. `Brand`, the vehicle/parts master-data entity, has no relationship to this profile.

### 2. Closed theme tokens and code-owned layout presets

The profile contains a schema version, revision, layout preset ID and validated theme tokens. Presets are a closed, versioned registry implemented and tested in ACP code. Slice 1 starts with `standard-v1`; additional layouts require code review and render fixtures, not tenant-uploaded templates.

| Input | Slice 1 contract |
|---|---|
| Logo | Optional reference to an authorized, immutable image asset version; never an arbitrary URL |
| Primary and secondary colors | Canonical six-digit hex color values, subject to legibility validation |
| Font | ACP-bundled default font only; no font upload, remote font URL or arbitrary font-family expression |
| Header/footer bands | Optional preset-defined bands using validated colors and fixed safe geometry |
| Header/footer text | Bounded plain text, escaped by the renderer; no markup, interpolation or legal-data overrides |
| Layout | `standard-v1`, with ACP-controlled page geometry, logo fit and reserved content areas |

The Feature Spec must pin numeric text, upload, image and band limits and validation errors before implementation. These limits are server-owned. Unknown keys, unsupported presets and invalid values are rejected; no generic CSS property bag is permitted. Manual configuration and extraction proposals use the same schema.

### 3. Upload, extract, propose, confirm

An authorized administrator uploads a PDF or PNG into private, tenant-isolated GCS storage. Validate the actual file type and bounded resource usage before parsing. Extract visual hints with heuristics and/or vision into a proposal containing only allowed tokens and a supported preset ID. The original document is reference material, not a renderable full-page background.

Extraction never activates or replaces a profile. Show the proposed appearance in a preview with warnings for uncertain or unsupported elements; the administrator edits and explicitly confirms it. Confirmation revalidates the schema, asset ownership and expected profile revision so a stale proposal cannot overwrite a newer edit. Record the confirming actor, time and revision.

Extraction failure, low confidence, unsupported artwork or provider unavailability leaves the current profile unchanged. Manual token editing and an ACP default preview remain available without a successful extraction. Only confirmed profiles affect newly committed invoices; previews and proposals are not fiscal records.

Instructions embedded in the upload cannot alter extraction policy or invoke tools. A model may suggest values, but cannot select unregistered assets, emit HTML, change seller data or publish the profile. Any vision provider's data-handling and retention configuration must be reviewed in the Feature Spec before uploaded documents are sent to it.

### 4. Brand the chrome; ACP owns the document body

Branding controls the logo, decorative bands, accent colors and bounded non-authoritative text. ACP owns tables, line wrapping, page breaks, totals, tax presentation, invoice identifiers and mandatory seller/customer and DACH legal content governed by ADR-0023. Decorative text must not replace those blocks. Legal identity and payment facts come from the invoice snapshot, not extraction results or branding tokens.

Presets reserve space for header/footer chrome on every applicable page. Long text, oversized logos or unsuitable contrast must produce validation feedback or a safe preview adjustment before confirmation; they cannot hide, overlap or truncate mandatory content. Include multi-page and long-content fixtures. Branding does not expand ADR-0023's supported AT/DE country profiles or establish CH or structured e-invoice support.

### 5. Freeze resolved branding at invoice commitment

Freeze resolved branding in the same transaction that commits the invoice's immutable seller and financial snapshot under ADR-0023. This is the first legally committing transition, including paths that commit at `FINALIZED` or directly at `ISSUED`; do not wait until an asynchronous render or subsequent delivery transition.

Snapshot the token schema version, resolved tokens, preset/render version and immutable asset references including object generation or equivalent content identity. A mutable profile ID or expiring signed URL is insufficient. Profile revision changes and invoice commitment must serialize consistently with ADR-0023's lock order, yielding one complete confirmed revision rather than mixed settings.

The worker reads frozen inputs only. Asset replacement creates a new object identity; objects referenced by committed documents remain retained and cannot be deleted by profile cleanup. Removing or changing a current profile affects future commitments only. Propose explicit profile/source-upload/retained-asset deletion rules in `docs/deletion-policy.md` when the later Feature Spec introduces those entities; this ADR does not add database entities itself.

Serve an existing archived invoice PDF unchanged. For branded invoices this explicitly tightens ADR-0007's overwrite-on-retry behavior: retries must not replace an existing archive with a new rendering. Initial publication must be idempotent under concurrent workers. If an archive is absent, render only from complete frozen inputs and retained renderer/assets; missing versions or assets fail visibly instead of substituting today's profile. Retaining versions supports recovery but does not promise byte-identical re-rendering across browser versions; the archived bytes remain authoritative.

Do not retrofit current branding onto historic invoices. Documents without branding snapshots retain their historical renderer behavior and ADR-0023's legacy evidence rules; never fabricate missing seller or branding evidence from live configuration.

### 6. Reuse the asynchronous PDF pipeline

Extend the existing snapshot-to-renderer input boundary and ADR-0007's Cloud Tasks → authenticated PDF worker → Playwright → private GCS archive flow. Preserve IAM/OIDC, HMAC tenant binding, resource/status checks and existing failure reporting. No new PDF library, tenant React template, browser-print path or public rendering endpoint is introduced.

The worker resolves only authorized immutable GCS assets and uses ACP-generated markup. Deny arbitrary outbound fetches from uploaded or extracted content. Profile edits do not enqueue historical invoice regeneration. Extraction is preparation work and must not run inside invoice commitment or become a dependency for invoice issuance.

### 7. Security and retention boundaries

Reject tenant-supplied HTML, CSS and JavaScript in every configuration path. Escape text, validate colors and enums, and normalize logo images to an approved raster format; do not pass uploaded PDF active content or SVG scripts into the renderer. Enforce file size, page count, image dimensions and processing time bounds before expensive extraction.

GCS paths alone are not authorization. Upload, preview, extraction, asset resolution and download must verify tenant ownership and the applicable entity/document permission. Use private objects and authorized short-lived access where needed; never persist bearer URLs as snapshot identity. Validate model output with an allowlisted token schema and verify every referenced asset separately.

Original uploads and extraction proposals need a bounded cleanup policy distinct from the retention of invoice-referenced assets and archived PDFs. Cleanup must not remove historical render dependencies. Exact operational limits and retention settings belong in the approved Feature Spec, with tenant-isolation and deletion tests before release.

## Consequences

### Positive

- Each legal seller can configure its appearance without changing the invoice engine.
- Manual setup works when extraction fails; human confirmation prevents silent branding changes.
- Frozen inputs and retained archive bytes preserve history after configuration changes.

### Negative

- Arbitrary letterheads will only be approximated; some artwork and typography cannot be reproduced.
- Asset retention, versioned rendering and concurrent confirmation add implementation and storage costs.
- Upload processing and optional vision extraction require resource limits and operational failure handling.

### Neutral

- Invoice calculations, numbering, fiscal locks, country profiles and site authorization remain governed by existing ADRs.
- No stock movements, accounting mappings or invoice lifecycle states are added by branding.
- API/schema changes and generated contracts belong to later implementation issues.

## Alternatives Considered

| Option | Benefit | Reason not selected |
|---|---|---|
| Tenant-wide branding | One configuration row | Cannot represent different legal sellers in the same tenant |
| Uploaded full-page letterhead background | Closely resembles the source | Can obscure body/legal content and repeat stale seller facts |
| Tenant HTML/CSS or React templates | Maximum flexibility | Untrusted execution/styling surface and unbounded support matrix |
| Resolve the current profile during rendering | Less snapshot storage | Queued renders and retries rewrite history after edits |
| Manual tokens only | Simplest setup and no extraction provider | Retained as fallback; does not fulfill the requested assisted upload path |
| Separate PDF engine | Independent layout tooling | Duplicates ADR-0007 infrastructure without a required benefit |

## Implementation Strategy and Checklist

- [x] Read AUT-317 through Linear CLI and inspect related ADRs and renderer boundaries.
- [x] Draft ADR-0024, register its number and record proposed deferrals.
- [ ] Product owner reviews the proposed decisions; record acceptance and date only after explicit approval.
- [ ] Open the ADR PR, complete repository-required checks and review, then mark it ready.
- [ ] Subsequent Feature Spec fixes schema/API details, limits, extraction provider policy, authorization, deletion policy and release fixtures against the accepted ADR.
- [ ] Implement profile/manual preview and snapshot integration before enabling assisted extraction. Runtime work follows a separately approved plan and TDD.

Slice 1 targets branding of newly committed invoices through existing issuance paths. Extra presets, franchise packs and job-card reuse are deferred in the [deferrals log](../.architecture/deferrals.md). Credit-note branding also requires an explicit follow-on contract for whether it inherits the original appearance; this ADR does not silently extend that scope.

## Pragmatic Enforcer Analysis

- Necessity **8/10**: the requested per-seller identity cannot be supplied by one fixed template. Waiting delays adoption, but does not justify arbitrary template execution.
- Complexity **5/10**; complexity/necessity **0.63**: bounded tokens and one preset reuse existing infrastructure; extraction and retained assets account for most added cost.
- Simpler alternative: ship manual tokens first using the same contract, then enable assisted extraction after its operational review.
- Recommendation: accept this bounded architecture after PO review. Defer additional layouts and document families until a concrete customer need justifies fixtures and maintenance.

## Validation and Approval Gates

- [ ] Dejan Dosenovic accepts this decision record; then change this status and the index to Accepted.
- [ ] Feature Spec proves two tenants and two legal entities cannot share unauthorized profiles/assets; document access remains site-scoped.
- [ ] Tests cover extraction failure, malicious inputs, manual setup, explicit confirmation and stale-revision rejection.
- [ ] Render fixtures cover default/branded output, multi-page tables, long text and protected legal blocks.
- [ ] Commitment races, delayed workers, retries, profile edits and asset replacement preserve one frozen appearance and existing archive bytes.
- [ ] Historical documents do not acquire live branding; unavailable frozen dependencies fail explicitly.

## References

- [ADR-0004: Invoice Snapshotting Policy](2026-04-12-invoice-snapshotting.md).
- [ADR-0007: Asynchronous PDF Generation Pipeline](2026-04-12-async-pdf-pipeline.md).
- [ADR-0023: Legal Invoice Snapshots, Credit Notes and Accounting Export](2026-09-20-legal-invoicing-and-accounting-export.md).
- [ADR-0022: Site Operational Scope](2026-08-31-site-operational-scope.md).
- Source boundaries: `apps/core-api/src/invoices/invoice-pdf.service.ts`, `apps/core-api/src/invoices/invoice-snapshot.ts`, and `apps/core-api/prisma/schema.prisma`.

## Linear Tracking

| Field | Value |
|---|---|
| Project | [LegalEntity Document Branding & Letterhead](https://linear.app/auto-core-platform/project/legalentity-document-branding-and-letterhead-28dc131cc98c) |
| Milestone | 0 — Spec & ADR |
| Issue | [AUT-317](https://linear.app/auto-core-platform/issue/AUT-317/adr-legalentity-document-branding-and-letterhead-extract) |
| Handoff | Feature Spec proceeds against this record after PO acceptance; no runtime implementation is included here |
