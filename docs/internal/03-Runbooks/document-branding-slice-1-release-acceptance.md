# Document branding Slice 1 release acceptance

**State: BLOCKED for production acceptance.** Automated implementation evidence is linked below. The rendered-PDF approvals, extraction-provider approval, target-environment controls, and monitoring evidence still require named human owners and actual evidence.

## Implementation and CI evidence

| Issue | Evidence | State |
|---|---|---|
| AUT-322 profile, asset, and manual settings | [PR #597](https://github.com/vandean25/auto-core-platform/pull/597); [successful backend CI job](https://github.com/vandean25/auto-core-platform/actions/runs/36421531729/job/108928745240); `apps/core-api/test/document-branding.e2e-spec.ts` | Merged; CI passed |
| AUT-323 immutable snapshots and PDF archives | [PR #598](https://github.com/vandean25/auto-core-platform/pull/598); [successful backend CI job](https://github.com/vandean25/auto-core-platform/actions/runs/36505116916/job/109204696256); `apps/core-api/test/invoice-branding-archive.e2e-spec.ts` | Merged; CI passed |
| AUT-324 ACP-managed extraction and confirmation | [PR #600](https://github.com/vandean25/auto-core-platform/pull/600); [successful backend CI job](https://github.com/vandean25/auto-core-platform/actions/runs/36568301547/job/109405632780); `apps/core-api/test/document-branding-extraction.e2e-spec.ts` | Merged; CI passed |
| AUT-325 visual acceptance fixtures | [PR #608 checks and CI artifact](https://github.com/vandean25/auto-core-platform/pull/608/checks); CI artifact: `document-branding-visual-fixtures` | CI passed; automated artifact generated and inspected; human review remains pending |

The AUT-325 render suite creates synthetic PDFs for AT and DE defaults, AT/DE standard branding, enabled DE margin treatment, square/tall/wide transparent logos, long seller legal fields, 120-character decorative text, all nine `header_band` × `footer_band` pairs, and a 100-line invoice that must span at least ten pages. Its manifest records fixture IDs, tax/band/logo inputs, page count, PDF SHA-256, renderer/font identifiers, font-manifest SHA-256, Chromium version, and generation time. Review fields remain pending by design. PR CI retains the files for 14 days; download and preserve them in the approval record before expiry if reviewers need longer.

## Automated acceptance matrix

| Requirement | Existing evidence source | Current evidence |
|---|---|---|
| Tenant and legal-entity isolation, role and membership checks | `apps/core-api/test/document-branding.e2e-spec.ts` | AUT-322 backend CI passed |
| Site-scoped invoice access and download | `apps/core-api/src/invoices/invoice-pdf.service.ts#getPdf` scopes by tenant and authorized site IDs; `apps/core-api/src/invoices/invoice-pdf.service.spec.ts` asserts that query; `apps/core-api/test/site-context.e2e-spec.ts` verifies site membership | Query scope verified locally (20 service tests passed); site-context E2E passed in prior backend CI. A direct cross-site invoice download request remains a route-level coverage gap |
| Hostile upload limits, source parsing bounds, and no outbound resource requests | `apps/core-api/test/document-branding.e2e-spec.ts`; `apps/core-api/test/invoice-branding-render.e2e-spec.ts` | AUT-322 backend E2E passed; AUT-325 render E2E passed in PR CI |
| Draft/confirmation races and immutable asset retention | `apps/core-api/test/document-branding.e2e-spec.ts`; `apps/core-api/test/invoice-branding-archive.e2e-spec.ts` | AUT-322 and AUT-323 backend CI passed |
| Concurrent archive publication, crash recovery, and exact-byte replay | `apps/core-api/test/invoice-branding-archive.e2e-spec.ts`; `apps/core-api/src/invoices/invoice-pdf.service.spec.ts` | AUT-323 backend CI passed |
| Extraction unavailable/failure and manual configuration fallback | `apps/core-api/test/document-branding-extraction.e2e-spec.ts` | AUT-324 backend CI passed; production provider remains disabled |
| Visual layout, content extraction, pagination, and generated artifact | `apps/core-api/test/invoice-branding-render.e2e-spec.ts`; [PR #608 checks and CI artifact](https://github.com/vandean25/auto-core-platform/pull/608/checks); `document-branding-visual-fixtures` artifact | AUT-325 PR CI passed, including E2E and artifact upload; generated header and footer ellipses were visually verified; PO/accountant review remains pending |

These links show the merged implementation checks; the AUT-325 PR checks page above is the stable link for the final render run and artifact. A green check does not substitute for a human visual or legal review.

## Human release gates

| Gate | Required evidence | Owner | State |
|---|---|---|---|
| Rendered invoice acceptance | PO and accountant inspect the actual synthetic PDFs across activated country/tax profiles; record names, decisions, UTC dates, and artifact links | PO and accountant to be designated | **PENDING** |
| Extraction activation | Exact provider, model/version, region, retention/data terms, cost cap, and parser package/version; explicit product/operations approval | Product/operations approver to be designated | **PENDING — keep `DOCUMENT_BRAND_EXTRACTION_PROVIDER=disabled` in Cloud Run until approved** |
| Object storage and IAM | Target-environment bucket identity, retention/lifecycle, exact prefixes/generations, writer and cleanup principals, and permission checks | Deployment owner to be designated | **BLOCKED — target environment not checked** |
| Monitoring and response | Dashboard/alert links, observed signals, thresholds, on-call owner, and a verified alert/recovery exercise for PDF publication, upload cleanup, and extraction lease recovery | Operations owner to be designated | **BLOCKED — no target-environment evidence recorded** |
| Deployment and rollback | Migration/deploy order, writer gate state, rollback owner and change record; show rollback preserves issued PDFs, retained logo generations, readers, and fonts | Release owner to be designated | **BLOCKED — target environment not checked** |
| Invoice finalize smoke (writer gate) | **Manual only:** finalize a test sales invoice and confirm PDF archive metadata (not automated in Cloud Build — immutable legal invoice in live UAT DB). See [archive rollout runbook](document-branding-archive-rollout.md). | Release owner (AUT-366) | **PENDING — human step** |

### Approval collection

The AUT-325 artifact is available from the stable [PR checks page](https://github.com/vandean25/auto-core-platform/pull/608/checks). Provide that link and the required provider evidence to the designated PO, accountant, and product/operations approver. The artifact is retained by CI for 14 days; preserve it durably if review may extend beyond that period. Record only actual responses in this table. No reviewer, decision, date, or approval may be inferred from CI or agent inspection. If the user has not designated reviewers or a response has not arrived, leave the gate pending and AUT-325 open.

## Deployment and operations

Follow [the archive rollout runbook](document-branding-archive-rollout.md) in its listed order. Deploy additive metadata and readers first; verify target storage, generation, hash, retention, IAM, cleanup principal, and monitoring; keep branded issuance disabled until evidence is accepted. Manual profile configuration and preview remain available when the extraction provider is unavailable. Do not activate outbound extraction before its provider gate is approved.

Recovery behavior already covered in implementation tests:

- Upload recovery uses persisted asset state and generation-matched deletes; failed cleanup remains retryable and is not treated as complete until the exact object generation is deleted or verified absent.
- Extraction recovery reclaims expired worker leases, retries within the configured attempt limit, and marks exhausted work failed without changing the active profile.
- Archive publication reuses the deterministic immutable object identity, verifies existing bytes, and repairs invoice metadata after a successful object write; do not delete a published generation during rollback.
- Rollback disables new branded issuance and preserves historical invoice evidence, readers, fonts, logo generations, and archive objects. Do not run destructive cleanup as part of rollback.

Target-environment dashboards, alert thresholds, exercise results, release owner, and change-record URL are intentionally not populated until observed.
