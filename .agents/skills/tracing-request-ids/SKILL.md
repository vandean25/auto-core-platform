---
name: tracing-request-ids
description: Use when debugging a production or Cloud Run error from a request id, x-request-id, Error ID, Sentry event id, audit requestId, or a 500 toast. Also trigger on Cloud Logging SEARCH, http_error JSON, or correlating PDF/API failures.
---

# Tracing errors by request id

ACP stamps every HTTP call with `x-request-id` (UUID). That id is the join key across Cloud Logging, audit logs, and sometimes Sentry. Do not guess from the UI toast alone.

## Which UUID is this?

| User said | Usually is | Where it lives |
| --- | --- | --- |
| request id | `x-request-id` | Response header, `http_request` / `http_error` logs, Audit Logs search |
| Error ID | Sentry `eventId` | JSON body `eventId` on 500s; toast via `getErrorMessage` |
| task id | Cloud Tasks name | PDF enqueue response `taskId` — different from request id |

Invoice PDF toasts often drop `eventId` (`throw new Error(payload.message)`). Workshop toasts keep it. If they gave a UUID, search logs first; Sentry second.

## Cloud Logging (do this first)

Logs are **Nest text on stderr**, not `jsonPayload.requestId`. A structured filter on `jsonPayload.requestId` returns empty even when the id is in the line.

GCP project for `core-api`: **`auto-core-platform`** (not `auto-core-platform-vande`). Region `europe-west3`, service `core-api`.

PowerShell — **single-quote** the filter or the UUID splits:

```powershell
gcloud logging read 'SEARCH("ddb1c391-c5a6-4052-9d6a-6986e21a6e71")' --project=auto-core-platform --limit=20 --freshness=14d --format=json
```

Expect a pair:

- `GlobalExceptionFilter` `type: http_error` — **message**, status, tenantId, actorId
- `HttpLoggingInterceptor` `type: http_request` — **method, path, durationMs, errorName**

Read both. The path tells you which PDF/API. The message is the cause. Duration ~10s on PDF often means Playwright rendered, then storage/config failed.

## Then correlate

1. **Audit Logs** → search that request id (mutations on the same call).
2. **Sentry** → search extra/tags for `requestId` or the `eventId` if they gave Error ID.
3. **Env/config** → missing `INVOICE_PDF_BUCKET` / Cloud Tasks shows up as `InternalServerErrorException` in `http_error.message`.

## Red flags

- Searching `auto-core-platform-vande` (Firebase/hosting project) for API logs
- Using `jsonPayload.requestId="..."` as the only filter
- Treating Sentry event id as Cloud Tasks `taskId`
- Patching PDF/render code before reading `http_error.message`
