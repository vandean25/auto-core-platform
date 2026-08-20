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

1. **Triggering:** When a document transitions to a PDF-eligible status, the backend dispatches an asynchronous task to a Cloud Tasks queue (via `cloud-tasks.service.ts`). For `Invoice`, PDF generation is only allowed once the record is `ISSUED` or `PAID`. The API immediately returns an HTTP 200 to the frontend.
2. **Rendering:** A background worker picks up the task, validates that the requested entity type is supported by this pipeline and that the record is still in an allowed renderable status, and uses `playwright-browser.service.ts` to spin up a headless Chromium instance.
3. **Execution:** The worker generates the full HTML for the target document and passes it directly to Playwright via `page.setContent(...)`. Playwright then executes `page.pdf()` using strict A4 dimensions and pre-calculated margins. The current implementation does **not** navigate to an internal `/render/...` HTTP route.
4. **Storage:** The resulting binary buffer is uploaded to Google Cloud Storage (Bucket). The `pdf_storage_key` and `pdf_generated_at` timestamps are written back to the entity (e.g., `Invoice` or `WorkshopOrder` table).
5. **Real-Time Notification:** The update to the database record triggers the Prisma real-time extension, broadcasting a WebSocket event. The frontend UI, which has been showing a "Generating PDF..." spinner, receives the event, invalidates its query cache, and smoothly replaces the spinner with a "Download PDF" button.

### Security Model for PDF Generation

Production uses a **split deployment** between the user-facing API and a dedicated PDF worker. Authentication spans two layers: Cloud Run IAM (transport) and application HMAC (payload integrity + tenant binding).

#### Roles

| Service | Responsibility | Cloud Tasks config |
|---------|----------------|-------------------|
| `core-api` | Enqueues PDF tasks; never launches Chromium in production | `CLOUD_TASKS_ENABLED`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_TARGET_BASE_URL`, `CLOUD_TASKS_INVOKER_SA`, `CLOUD_TASKS_WORKER_SECRET` |
| `core-api-pdf-worker` | Renders PDFs via Playwright; validates worker requests | `CLOUD_TASKS_WORKER_SECRET` only (must **not** receive enqueue env vars — it must not enqueue to itself) |

#### Transport authentication (Cloud Run IAM + OIDC)

1. **`core-api-pdf-worker` is not public.** Deployed with `--no-allow-unauthenticated`. Ingress remains open so Cloud Tasks can reach the service URL; unauthenticated browser traffic is rejected by Cloud Run IAM.
2. **Cloud Tasks OIDC token.** When `core-api` enqueues a task, `cloud-tasks.service.ts` sets `httpRequest.oidcToken` with `serviceAccountEmail` = `CLOUD_TASKS_INVOKER_SA` and `audience` = the worker origin (`scheme://host`, not the `/pdf/worker` path).
3. **Invoker IAM.** Create `cloud-tasks-pdf-invoker@auto-core-platform.iam.gserviceaccount.com` if it does not exist. That OIDC service account must hold `roles/run.invoker` on `core-api-pdf-worker`. The `core-api` Cloud Run runtime service account that creates tasks must hold `iam.serviceAccounts.actAs` on the invoker SA **and** permission to enqueue on `pdf-queue` in `europe-west3` (`roles/cloudtasks.enqueuer` on the queue, or `cloudtasks.tasks.create` on that queue resource).

#### Application authentication (HMAC + tenant binding)

4. **HMAC worker secret.** Every task carries `x-cloud-tasks-secret` (shared GSM secret) and a signed JSON body `{ kind, resourceId, tenantId, signature }`. `CloudTasksWorkerGuard` and `PdfTaskTenantGuard` validate the secret and bind tenant context before rendering.
5. **Entity and status validation.** The worker only renders entity types registered in this pipeline and only when their status is allowed (`ISSUED`/`PAID` for `Invoice`, `INVOICED` for `WorkshopOrder`).
6. **Server-side HTML generation.** PDFs are produced from server-generated HTML via `page.setContent(...)` — no browser navigation to an internal render route.

#### Fail-closed production behavior

If Cloud Tasks configuration is incomplete on `core-api` (missing queue, target URL, invoker SA, or worker secret), PDF `requestGeneration` throws in production rather than falling back to inline Playwright.

> ⚠️ **Invariant:** Any future change to this split worker/renderer boundary must preserve explicit transport **and** application authentication before shipping.

## Consequences

### Positive

- **100% Visual Consistency:** Every PDF is generated by exactly the same Chromium engine using CSS `@media print` standards. It looks perfectly identical whether generated today or retrieved five years from now.
- **Snappy UI:** The user does not wait for a synchronous HTTP request to generate a 2MB PDF. The immediate hand-off feels instantaneous.
- **Server Stability:** PDF generation is memory-heavy. Offloading it to background queues prevents the main API thread from blocking and crashing during high load.
- **Immutable Archiving:** The exact visual document sent to the customer is archived in GCS permanently.

### Negative

- **Infrastructure Complexity:** Requires managing Google Cloud Tasks queues, GCS Buckets, Headless Chromium layers in the deployment container, and a dedicated `core-api-pdf-worker` Cloud Run service that runs Playwright separately from the user-facing `core-api` service.
- **Testing Difficulty:** Automated tests for PDF visual regressions are brittle and difficult to assert programmatically.
- **Error Handling UX:** If a background task exhausts all Cloud Tasks retries (default: 5 attempts with exponential backoff), the entity's `pdf_generation_error` field is set to the last failure reason and `pdf_generated_at` remains `null`. The frontend detects this null state after a configurable timeout and renders a "Retry Generation" button that re-enqueues the task. The schema fields involved are `pdf_storage_key` (nullable string), `pdf_generated_at` (nullable timestamp), and `pdf_generation_error` (nullable string) — present on both `Invoice` and `WorkshopOrder` tables. A dedicated Feature Spec is required before implementing the "Retry Generation" UI.

### Neutral

- Production deploys two Cloud Run services from the same compiled Nest application but separate images: `core-api` uses a Node 22 slim image without browser binaries (enqueue-only, 512Mi), while `core-api-pdf-worker` uses the pinned Playwright image (render worker, 2Gi, concurrency 1). Cloud Tasks `CLOUD_TASKS_TARGET_BASE_URL` points at the worker service URL with `/api` prefix.
- A dedicated render route must be maintained for each new entity type added to the pipeline (one route per document type).
- Playwright and headless Chromium add significant size to the PDF worker image (~300 MB); the user-facing API image does not carry those browser binaries.
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

- `apps/core-api/src/common/cloud-tasks.service.ts`
- `apps/core-api/src/common/playwright-browser.service.ts`
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
