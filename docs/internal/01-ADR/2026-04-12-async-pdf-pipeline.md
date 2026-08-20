---
title: "ADR-0007: Asynchronous PDF Generation Pipeline"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Architecture Team"
linear-project: "eb5521ba858e"
linear-milestone: "N/A"
tags:
  - adr
  - pdf
  - infrastructure
  - async
---

# ADR-0007: Asynchronous PDF Generation Pipeline

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

Generating highly formatted, legal, and professional PDF documents (like Sales Invoices and Workshop Job Cards) is a resource-intensive operation.

Historically, systems either relied on:
1. *Synchronous generation:* The user clicks "Print", and the backend hangs for 5-10 seconds generating the PDF before returning HTTP 200. This leads to connection timeouts and poor UX.
2. *Frontend printing:* Relying on the browser's `window.print()` functionality. This produces wildly inconsistent results depending on the user's browser, OS, and local print margins, and fails to automatically archive a "true" digital copy on the server.

We needed a scalable, consistent, and fast mechanism to generate complex React-based layouts into immutable PDFs and store them for historical compliance.

## Decision

We have implemented an **Asynchronous Headless-Browser PDF Pipeline** using Google Cloud Tasks and Playwright. PDF generation is currently supported for the following entity types only:

| Entity | Trigger Status |
|--------|---------------|
| `Invoice` | `ISSUED` / `PAID` |
| `WorkshopOrder` | `INVOICED` |

Any future entity requiring PDF support (e.g., `PurchaseOrder`) must be explicitly added to this table and its corresponding service registered in the pipeline.

1. **Triggering:** When a document transitions to a PDF-eligible status, the backend dispatches an asynchronous task to a Cloud Tasks queue (via `cloud-tasks.service.ts`). For `Invoice`, PDF generation is only allowed once the record is `ISSUED` or `PAID`. The API immediately returns an HTTP 200 to the frontend. In production, an unavailable or incomplete task configuration fails closed instead of rendering inline.
2. **Rendering:** A dedicated `core-api-pdf-worker` Cloud Run service, deployed from the same API image, picks up the task, validates that the requested entity type is supported by this pipeline and that the record is still in an allowed renderable status, and uses `playwright-browser.service.ts` to spin up a headless Chromium instance. The worker is isolated at 2 GiB memory, concurrency 1, and zero-to-two instances; the user-facing `core-api` remains at 512 MiB and does not launch Chromium for request-path PDF generation.
3. **Execution:** The worker generates the full HTML for the target document and passes it directly to Playwright via `page.setContent(...)`. Playwright then executes `page.pdf()` using strict A4 dimensions and pre-calculated margins. The current implementation does **not** navigate to an internal `/render/...` HTTP route.
4. **Storage:** The resulting binary buffer is uploaded to Google Cloud Storage (Bucket). The `pdf_storage_key` and `pdf_generated_at` timestamps are written back to the entity (e.g., `Invoice` or `WorkshopOrder` table).
5. **Real-Time Notification:** The update to the database record triggers the Prisma real-time extension, broadcasting a WebSocket event. The frontend UI, which has been showing a "Generating PDF..." spinner, receives the event, invalidates its query cache, and smoothly replaces the spinner with a "Download PDF" button.

### Security Model for PDF Generation

The security boundary for PDF generation is the **worker task execution path**, not a dedicated internal render route. The worker Cloud Run service is reachable by Cloud Tasks at the network layer, but worker routes are not browser functionality and require both the HMAC header and signed tenant payload. The implementation relies on the following controls:

1. **Worker-only execution:** PDF generation is initiated asynchronously through Cloud Tasks and processed by the dedicated worker service's worker path. There is no separately exposed `/render/:entity/:id` endpoint used by Playwright.
2. **Entity and status validation:** The worker only renders entity types explicitly registered in this pipeline and only when their status is one of the allowed final statuses documented above (`ISSUED`/`PAID` for `Invoice`, `INVOICED` for `WorkshopOrder`). Tasks for unsupported entities or invalid statuses must be rejected rather than rendered.
3. **Server-side HTML generation:** Because the PDF is produced from server-generated HTML passed to `page.setContent(...)`, there is no browser navigation to an internal backend route and therefore no route-level guard in this flow.

> ⚠️ **Invariant:** Any future change that introduces an HTTP-based render endpoint or a new cross-service rendering boundary **must** define explicit authentication and authorization for that boundary before shipping. The current worker boundary uses the HMAC header plus signed tenant payload and must retain both controls.

## Consequences

### Positive

- **100% Visual Consistency:** Every PDF is generated by exactly the same Chromium engine using CSS `@media print` standards. It looks perfectly identical whether generated today or retrieved five years from now.
- **Snappy UI:** The user does not wait for a synchronous HTTP request to generate a 2MB PDF. The immediate hand-off feels instantaneous.
- **Server Stability:** PDF generation is memory-heavy. Offloading it to a separately scaled worker prevents the main API process from launching Chromium, blocking request handling, or crashing during high load.
- **Immutable Archiving:** The exact visual document sent to the customer is archived in GCS permanently.

### Negative

- **Infrastructure Complexity:** Requires managing Google Cloud Tasks queues, GCS Buckets, a dedicated worker Cloud Run service, and Headless Chromium layers in the deployment image.
- **Testing Difficulty:** Automated tests for PDF visual regressions are brittle and difficult to assert programmatically.
- **Error Handling UX:** If a background task exhausts all Cloud Tasks retries (default: 5 attempts with exponential backoff), the entity's `pdf_generation_error` field is set to the last failure reason and `pdf_generated_at` remains `null`. The frontend detects this null state after a configurable timeout and renders a "Retry Generation" button that re-enqueues the task. The schema fields involved are `pdf_storage_key` (nullable string), `pdf_generated_at` (nullable timestamp), and `pdf_generation_error` (nullable string) — present on both `Invoice` and `WorkshopOrder` tables. A dedicated Feature Spec is required before implementing the "Retry Generation" UI.

### Neutral

- A dedicated worker route must be maintained for each new entity type added to the pipeline (one route per document type).
- Playwright and headless Chromium add significant size to the shared deployment image (~300 MB). The API image retains these binaries for deployment parity, but only the worker service is sized and configured to launch Chromium.
- GCS storage costs scale linearly with document volume. Retention policy for archived PDFs (e.g., delete after 7 years per legal requirement) must be configured at the bucket level, not in application code.
- PDF generation is idempotent: re-triggering for the same entity overwrites the existing GCS object and updates `pdf_storage_key`. Historical copies are not versioned by default unless GCS object versioning is enabled on the bucket.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Server-side PDF Gen (PDFKit/pdfmake) | Very fast, doesn't require a browser. | Nightmare to style. Cannot reuse our existing React components or Tailwind CSS. Requires writing layout in XY coordinates. |
| Browser `window.print` | Free, zero infrastructure. | No server-side archiving possible. Margins and headers/footers vary by the user's browser and printer driver. Unacceptable for legal invoices. |
| React-PDF (`@react-pdf/renderer`) | Server-side, no browser required. Faster than headless Chromium. | Requires a completely separate, duplicate component implementation using React-PDF primitives — cannot reuse the existing Tailwind-based component tree. Significant maintenance surface. |
| Puppeteer (instead of Playwright) | More widely used for headless PDF in Node. Larger ecosystem of examples. | Playwright is already a project dependency (used in E2E testing), so no additional binary is introduced. Playwright's `page.pdf()` API has better timeout handling and built-in waiting strategies for network idle. Playwright is preferred to avoid a second headless browser runtime in the container. |

## References

- `apps/core-api/src/common/services/cloud-tasks.service.ts`
- `apps/core-api/src/common/services/playwright-browser.service.ts`
- `apps/core-api/src/invoices/invoice-pdf.service.ts`
- `apps/core-api/src/workshop/workshop-pdf.service.ts`
- ADR-0001: `2026-04-12-prisma-extends-realtime-sync.md` — governs the WebSocket emission pattern used in Step 5 of this pipeline

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [PDF Generation Service & API](https://linear.app/auto-core-platform/project/pdf-generation-service-and-api-eb5521ba858e) |
| Milestone | Assorted PDF milestones |
| Issues | AUT-19, AUT-10, AUT-9, AUT-8, AUT-5, etc. |
