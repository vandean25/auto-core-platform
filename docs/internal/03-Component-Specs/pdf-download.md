---
title: "usePdfDownload Hook & Async PDF Generation"
date: "2026-10-07"
tags:
  - component-spec
  - hooks
  - pdf
  - async
---

# PDF Download Hook (`usePdfDownload`)

## Purpose

> `usePdfDownload` is the universal, standardized React hook for orchestrating asynchronous PDF generation, polling, and downloading across the Auto Core Platform. It provides a rock-solid, production-grade abstraction over our asynchronous headless-browser PDF pipeline (ADR-0007), eliminating race conditions, preventing double-click duplication, managing loading states and notifications, and cleanly handling component unmounting.

Historically, PDF printing across pages suffered from divergent implementations, ad-hoc polling loops, missing error diagnostics, and a critical race condition (AUT-330) where GET requests were dispatched immediately before generation completed, yielding premature 404 errors. `usePdfDownload` provides a single authoritative mechanism for all document types (Invoices, Credit Notes, Estimates, Workshop Job Cards).

---

## Architecture & Workflow

### 1. Sequential POST-then-GET Pattern (Resolving AUT-330)
In our Cloud Tasks + Playwright asynchronous pipeline (ADR-0007), requesting a PDF is a two-step operation:
1. **Trigger / Enqueue (`POST /api/.../pdf`):** Notifies the backend to render or enqueue the PDF. The backend responds with `{ mode: 'cached' | 'enqueued' | 'generated' }`.
2. **Retrieve Blob (`GET /api/.../pdf`):** Fetches the rendered `application/pdf` binary.

**The AUT-330 Race Condition:** Previous implementations sometimes triggered a GET download directly or immediately raced GET against POST. If the PDF was not yet cached or rendered, the GET endpoint returned `HTTP 404 ("PDF is not generated yet")`, which uncoordinated callers treated as a fatal failure.

**The Solution:**
- `generateAndDownloadPdfBlob` issues the `POST` request first to guarantee the job exists or render is kicked off.
- If the response mode is `cached`, it performs an immediate single `GET` fetch.
- If the response mode is `enqueued` (or `generated` in non-cached environments), it transitions to **exponential backoff polling**.
- While polling `GET`, any `404` status with message matching `PDF is not generated yet` is treated as a transient *pending* state (`isPdfNotReadyHttpStatus`), continuing the poll instead of failing. Any other HTTP status (e.g. 401, 403, 500) fails immediately.

### 2. Exponential Backoff Polling
Polling loops must balance rapid response for fast documents against network saturation and server load for heavy multi-page documents:
- **Initial Interval:** 1,500ms (`DEFAULT_PDF_POLL_INTERVAL_MS`)
- **Backoff Multiplier:** 1.5x (`DEFAULT_PDF_POLL_BACKOFF_MULTIPLIER`)
- **Max Interval Cap:** 5,000ms (`DEFAULT_PDF_POLL_MAX_INTERVAL_MS`)
- **Timeout Deadline:** 60,000ms (`DEFAULT_PDF_POLL_TIMEOUT_MS`)

Interval progression: `1500ms -> 2250ms -> 3375ms -> 5000ms -> 5000ms...`

### 3. Double-Click & Concurrent Request Guard
Rapidly clicking "Print" can flood the backend with redundant Cloud Tasks generation jobs:
- `usePdfDownload` maintains an internal `inFlightRef.current` flag.
- Subsequent calls to `download()` while a generation is in flight immediately return `false` without executing.
- `isLoading` / `isDownloading` state remains `true` throughout the process, allowing UI buttons to render spinners and `disabled={isLoading}` attributes.

### 4. Component Unmount & Abort Handling
When a user clicks "Print" and quickly navigates away:
- An internal `AbortController` is created for each download sequence.
- On component unmount (`useEffect` cleanup), `abortControllerRef.current.abort()` is called.
- In-flight fetch requests are aborted via `signal`.
- Sleep timers in the backoff loop are cancelled immediately.
- Pending toasts are dismissed (`toast.dismiss(toastId)`).
- No orphan state updates or error toasts are emitted after unmount.

### 5. Fail-Fast Entity Error Detection (`checkGenerationFailed`)
If PDF generation fails asynchronously on the backend worker (e.g. rendering failure or missing template data), the entity record in the database may be updated with `pdf_generation_error` or status `FAILED`.
- Instead of needlessly polling until the 60s timeout, callers can provide an optional `checkGenerationFailed` callback.
- On every poll cycle before the GET request, `checkGenerationFailed()` is queried.
- If it returns an error string, polling terminates immediately with the exact backend failure message.

### 6. Centralized Toast Notification Lifecycle
`usePdfDownload` automatically manages the user notification lifecycle using `sonner`:
1. `toast.loading('Preparing PDF, this may take a few seconds...')` on trigger.
2. Updates toast to `toast.loading('Generating PDF in the background...')` on poll attempt 1.
3. Updates toast to `toast.success('PDF downloaded successfully')` upon blob receipt and download trigger.
4. Updates toast to `toast.error(errorMessage)` on failure, or dismisses on abort.

---

## Hook API Reference

### `usePdfDownload(config?: Partial<UsePdfDownloadConfig>): UsePdfDownloadResult`

The hook can be configured upfront with default parameters, and individual options can be optionally overridden when calling `download(overrideConfig)`.

### Configuration Options (`UsePdfDownloadConfig`)

| Property | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `postUrl` | `string \| (() => string)` | — | **Yes** | API endpoint to trigger generation (`POST`). Can be a getter function to resolve dynamically once entity data is loaded. |
| `getUrl` | `string \| (() => string)` | — | **Yes** | API endpoint to fetch the PDF blob (`GET`). Can be a getter function. |
| `filename` | `string \| (() => string)` | `'document.pdf'` | **Yes** | Suggested download filename. Can be a getter function to sanitize entity numbers. |
| `checkGenerationFailed` | `() => Promise<string \| null>` | `undefined` | No | Optional callback invoked on each poll to check whether background generation failed early. |
| `timeoutMs` | `number` | `60000` (60s) | No | Maximum time allowed before timing out. |
| `intervalMs` | `number` | `1500` (1.5s) | No | Initial poll delay. |
| `backoffMultiplier` | `number` | `1.5` | No | Multiplier applied to polling delay after each attempt. |
| `maxIntervalMs` | `number` | `5000` (5s) | No | Maximum cap on polling interval delay. |
| `messages` | `UsePdfDownloadMessages` | (see below) | No | Custom toast notification messages. |
| `onSuccess` | `(blob: Blob) => void` | `undefined` | No | Callback invoked when PDF blob is successfully downloaded. |
| `onError` | `(error: unknown) => void` | `undefined` | No | Callback invoked when PDF generation or download fails. |

### Toast Messages (`UsePdfDownloadMessages`)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `preparing` | `string` | `'Preparing PDF, this may take a few seconds...'` | Initial toast message shown when button is clicked. |
| `generating` | `string` | `'Generating PDF in the background...'` | Updated toast message when polling is required. |
| `success` | `string` | `'PDF downloaded successfully'` | Toast message shown on download completion. |
| `errorFallback` | `string` | `'PDF-Erstellung fehlgeschlagen'` | Fallback error message if backend does not return an error detail. |
| `timeout` | `string` | `'PDF generation is taking longer than expected. Please try Print again in a moment.'` | Toast error message shown if timeout threshold is reached. |

### Return Value (`UsePdfDownloadResult`)

| Property | Type | Description |
|----------|------|-------------|
| `download` | `(overrideConfig?: Partial<UsePdfDownloadConfig>) => Promise<boolean>` | Async function to initiate the PDF generation and download. Resolves to `true` on success, `false` on failure/abort/double-click. |
| `isLoading` | `boolean` | `true` while generation or download is active; `false` otherwise. |
| `isDownloading` | `boolean` | Alias for `isLoading`. |

---

## Usage Example

### Invoices Detail Page (`InvoiceDetailPage.tsx`)

```tsx
import { Printer, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchInvoicePdfGenerationError } from '@/api/invoices'
import { usePdfDownload } from '@/hooks/usePdfDownload'

const INVOICES_API = '/api/invoices'

export function InvoicePrintAction({ invoice }: { invoice: Invoice }) {
  const { download: handlePrint, isLoading: isPrinting } = usePdfDownload({
    postUrl: () => `${INVOICES_API}/${invoice.id}/pdf`,
    getUrl: () => `${INVOICES_API}/${invoice.id}/pdf`,
    filename: () =>
      `invoice-${invoice.invoice_number || invoice.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase() + '.pdf',
    checkGenerationFailed: () =>
      invoice ? fetchInvoicePdfGenerationError(invoice.id) : Promise.resolve(null),
    messages: {
      success: 'Invoice PDF downloaded successfully',
      errorFallback: 'Fehler beim Erstellen der Rechnungs-PDF',
    },
  })

  return (
    <Button
      variant="outline"
      onClick={() => handlePrint()}
      disabled={isPrinting}
    >
      {isPrinting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Printer className="mr-2 h-4 w-4" />
      )}
      {isPrinting ? 'Generating...' : 'Print'}
    </Button>
  )
}
```

---

## Adding a New PDF Kind in the UI

When adding PDF generation and download for a new entity (e.g. for **AUT-354 Kostenvoranschlag / Estimates**, Workshop Orders, or Purchase Orders), follow this standard 4-step guide:

### Step 1: Define API Endpoints
Identify or add the endpoint URLs for triggering generation (`POST`) and polling/fetching the binary (`GET`).

For example, for Kostenvoranschlag / Estimates (`WorkshopEstimateVersion`):
- `POST /api/workshop/orders/:orderId/estimates/:estimateId/pdf`
- `GET /api/workshop/orders/:orderId/estimates/:estimateId/pdf`

In your feature API client file (e.g. `apps/core-web/src/api/estimates.ts`):
```typescript
export const ESTIMATES_API = '/api/workshop/estimates'
```

### Step 2: Define Error Lookup (`checkGenerationFailed`)
If the backend entity tracks asynchronous PDF generation status and failure messages, implement a quick lightweight lookup function to fail fast on errors:

```typescript
// apps/core-web/src/api/estimates.ts
import { fetchWithAuth } from './client'

export async function fetchEstimatePdfGenerationError(estimateId: string): Promise<string | null> {
  try {
    const res = await fetchWithAuth(`/api/workshop/estimates/${estimateId}/status`)
    if (!res.ok) return null
    const data = await res.json()
    return data.pdf_generation_error ?? null
  } catch {
    return null
  }
}
```
*(If the backend entity does not track explicit error fields, you can omit `checkGenerationFailed` or return `Promise.resolve(null)`).*

### Step 3: Wire `usePdfDownload` in the Component or Page
Instantiate `usePdfDownload` inside your page component, providing dynamic getters for URLs and sanitized filenames:

```tsx
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { fetchEstimatePdfGenerationError } from '@/api/estimates'

export function EstimateDetailPage({ estimate }: { estimate: Estimate }) {
  const { download: handlePrint, isLoading: isPrinting } = usePdfDownload({
    postUrl: () => `/api/workshop/estimates/${estimate.id}/pdf`,
    getUrl: () => `/api/workshop/estimates/${estimate.id}/pdf`,
    filename: () =>
      `estimate-${estimate.estimate_number || estimate.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase() + '.pdf',
    checkGenerationFailed: () =>
      estimate ? fetchEstimatePdfGenerationError(estimate.id) : Promise.resolve(null),
    messages: {
      preparing: 'Preparing estimate PDF...',
      generating: 'Generating estimate PDF in background...',
      success: 'Estimate PDF downloaded successfully',
      errorFallback: 'Fehler beim Erstellen des Kostenvoranschlags',
    },
  })
```

### Step 4: Bind Button `onClick` and `disabled`
Per our UI/UX Standards:
1. Place the action button in the **top-right header section** (or inside an `ActionGroup`).
2. Bind `onClick={() => handlePrint()}`.
3. Bind `disabled={isPrinting}` to prevent duplicate clicks while generating.
4. Render `<Loader2 className="animate-spin" />` and label `'Generating...'` when `isPrinting` is true.

```tsx
  return (
    <Button
      variant="outline"
      onClick={() => handlePrint()}
      disabled={isPrinting}
    >
      {isPrinting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Printer className="mr-2 h-4 w-4" />
      )}
      {isPrinting ? 'Generating...' : 'Print Estimate'}
    </Button>
  )
}
```

---

## Design Decisions

> **Sequential POST-then-GET over direct GET:** Directly hitting GET leads to race conditions when files aren't pre-rendered. Enforcing a preliminary POST guarantees that Cloud Tasks has enqueued the render job before the polling client expects a file ready.
> 
> **Getter functions for URLs and Filenames:** Detail pages often load entity data asynchronously via TanStack Query. Passing functions like `postUrl: () => ...` allows configuring the hook at component mount time without needing to recreate or rebind the hook when entity IDs change.
> 
> **Ref-based Config Synchronization:** The hook uses `configRef.current = config` on each render so callers can safely pass inline arrow functions without causing unnecessary re-renders or stale closures during long-running polls.
> 
> **Global Abort on Unmount:** Fast page navigation should never leave orphan background polling intervals burning network connections or triggering "Failed to load" toasts on unrelated screens.
> 
> **Standardized Double-Click Guard:** Both `inFlightRef` and `disabled={isLoading}` combine to ensure idempotency even when users double-click buttons aggressively.

---

## Related

- [[action-group|ActionGroup]] — Header action component that frequently hosts Print buttons
- [[status-badge|StatusBadge]] — Status display on documents whose finalization triggers PDF availability
- ADR-0007: Asynchronous PDF Generation Pipeline — Backend Cloud Tasks & Playwright architecture
- ADR-0025: Customer Communication and Approvals — Estimate versioning and PDF dispatch rules
