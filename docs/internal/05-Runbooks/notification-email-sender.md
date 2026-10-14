# Runbook: notification email sender (AUT-356)

**Status:** Stub (phases 2 to 6 of AUT-356: the worker, the fake provider and the inert stubs ship; three German customer drafts render; the estimate send can queue its email behind `CUSTOMER_ESTIMATE_SEND_ENABLED`; the public approval link and its evidence ship in phase 5 (2c); phase 6 adds the admin replay (§5a), the order communication timeline (§2d) and the go-live conditions (§7); no account is wired). Real provider wiring waits for [AUT-362](https://linear.app/auto-core-platform/issue/AUT-362) (DNS, DPA, sender domain). Customer sends also wait for the lawyer's sign-off on the copy (AUT-360 D19, D23) and for `CUSTOMER_ESTIMATE_SEND_ENABLED`.
**Architecture:** [ADR-0025](../01-ADR/2026-10-02-customer-communication-and-approvals.md) §6 and §10. The outbox table is written in the same transaction as the business change. A separate Cloud Tasks queue wakes a worker that sends from the row.

---

## 1. What runs where

| Piece | Where | Notes |
|---|---|---|
| Outbox writer | `core-api` (in the business transaction) | Never calls a provider. |
| Wake-up enqueue | `core-api` | Queue `CLOUD_TASKS_NOTIFICATION_QUEUE`, target `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL`. Never the PDF queue or the PDF target. |
| Worker route | `POST /api/notifications/outbox/:outboxId/worker` on the service behind `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL` | v1: `core-api` itself, because it holds the `NOTIFICATION_*` settings. Never the PDF worker, which holds none of them. |
| Recovery sweep | `core-api`, every minute, per tenant | Wakes due rows and releases expired claims. |
| Body purge | `core-api`, daily 03:17, per tenant | Clears message bodies 90 days after creation (metadata is kept). |
| Admin replay | `core-api`, `POST /api/notifications/outbox/replay` | Owner or admin only. Moves FAILED rows back to PENDING and queues a wake-up. It never sends inline (§5a). |

## 2. Environment flags (defaults fail closed)

| Variable | Default | Meaning |
|---|---|---|
| `NOTIFICATION_EMAIL_MODE` | `off` | `off`: every due email is recorded as SUPPRESSED (`EMAIL_DISABLED`). `fake`: in-memory provider, rejected in production. `live`: the real provider, for allowlisted recipients only. |
| `NOTIFICATION_EMAIL_PROVIDER` | `brevo` | Used only in `live`. `brevo` (planner default) or `ses` (eu-central-1). |
| `NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST` | empty | Comma list of exact addresses or `*@domain`. Empty means nothing is sent in `live`. |
| `NOTIFICATION_EMAIL_FROM_ADDRESS` | unset | Sender on the ACP domain. Required when the mode is `fake` or `live`. |
| `CLOUD_TASKS_NOTIFICATION_QUEUE` | unset | Queue name. Unset means no wake-ups; rows wait until it is set and the sweep runs. |
| `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL` | unset | Base URL of the service that handles wake-ups, in the same shape as `CLOUD_TASKS_TARGET_BASE_URL`. It must be a service that holds the `NOTIFICATION_*` settings. |
| `ESTIMATE_APPROVAL_BASE_URL` | unset | Public https base of the approval link in the estimate email, without a trailing slash, query, fragment or credentials (ADR-0025 §7). Required while `CUSTOMER_ESTIMATE_SEND_ENABLED` is on, and checked for that shape in every environment: the boot check refuses a missing or malformed value. |

The existing `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_INVOKER_SA`, `CLOUD_TASKS_WORKER_SECRET` and `CLOUD_TASKS_ENABLED` apply as they do for the PDF queue. The PDF target (`CLOUD_TASKS_TARGET_BASE_URL`) is never used for notifications.

**Changing the mode takes effect on the next attempt.** Setting `NOTIFICATION_EMAIL_MODE=off` is the rollback: queued rows are then suppressed, not sent.

In production, the boot check refuses a notification target on the same origin as `CLOUD_TASKS_TARGET_BASE_URL` (scheme, host and port; the path does not matter). It refuses a notification queue equal to `CLOUD_TASKS_QUEUE` in any environment. Either would send wake-ups to the PDF side, which holds no `NOTIFICATION_*` setting. There the route answers 404, and the rows wait until a sender answers or the sweep fails them as `STALE_UNSENT`.

In production, a `live` deploy also needs `CLOUD_TASKS_NOTIFICATION_QUEUE`, `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_INVOKER_SA` and `CLOUD_TASKS_WORKER_SECRET`, and it must not set `CLOUD_TASKS_ENABLED=false`. The boot check refuses it otherwise, because no row would be woken.

The worker route answers only when `NOTIFICATION_EMAIL_MODE` is set, and any non-blank value counts, `off` included. Set it on core-api, and never on the PDF worker. Unset is not off: a wake-up that reaches an instance without it gets a 404, so Cloud Tasks reports it, and nothing is suppressed. `off` runs the sender and records each due row as `SUPPRESSED`. The recovery sweep and the body purge run on every instance, whatever the mode.

## 2a. Customer message drafts (phase 3)

Three messages render from `apps/core-api/src/notifications/templates/customer-email-templates.ts`, in the formal German Sie form: `customer.estimate_sent`, `customer.estimate_approval_confirmed` and `customer.order_ready`, all at template version 1. A draft carries its template id and version into the outbox row. The copy is a draft until the lawyer signs it off (AUT-360 D19 and D23). Phase 3 renders the drafts and sends none of them. The estimate-sent draft takes the approval link as an input, because the message has no attachment (ADR-0025 section 6); phase 4 supplies that link and wires the estimate send behind `CUSTOMER_ESTIMATE_SEND_ENABLED`.

## 2b. Estimate send and approval link (phase 4)

- `POST /workshop/estimates/:versionId/send` takes an optional body, `{ "notifyCustomerByEmail": true }`. Without it the send is advisor-recorded and sends no email, as before. With it, the transaction that freezes the snapshot also mints the approval token and writes a `customer.estimate_sent` row to the customer's address.
- Refusals come before any write. The approval base is missing or invalid (503 `ESTIMATE_APPROVAL_LINK_UNAVAILABLE`). The advisor has not confirmed the address for order communication (422 `ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED`). The address is missing or not plain (`ESTIMATE_CUSTOMER_EMAIL_MISSING` and `ESTIMATE_CUSTOMER_EMAIL_INVALID`). The vehicle has no make or model (`ESTIMATE_VEHICLE_INCOMPLETE`). The seller name or the copy cannot be written (`ESTIMATE_EMAIL_INCOMPLETE`).
- The token is 32 random bytes, base64url, inside the link only. The database keeps its SHA-256 in `workshop_estimate_approval_tokens`. It expires at the version's `valid_until`, and it is invalidated when its version is superseded. The public GET and POST route (`/api/public/estimate-approvals/:token`) and the `/approve/:token` page read and decide the token (phase 5). Evidence goes to `workshop_estimate_approvals`; see ADR-0025 §7 and the system Prisma allowlist.
- `Customer.contact_email_ok` is `false` until the advisor confirms the address, through the customer create and update endpoints. A permanent refusal of the address (`RECIPIENT_REJECTED`, a hard bounce) clears the flag for that customer and that exact address (ADR-0025 §8).
- An approval link is removed from a row's body once the row reaches `ACCEPTED`, `FAILED` or `SUPPRESSED`. A notice that was never sent (`STALE_UNSENT`) loses its body. A retry keeps the link, because it still needs the body.
- The first send is woken by a task enqueued right after its send commits. If that task cannot be queued, the failure is logged, the row stays PENDING, and the recovery sweep wakes it after its 5-minute grace (the sweep's wake path has its own tests).

## 2c. Public approval route (phase 5)

- Routes: `GET` and `POST /api/public/estimate-approvals/:token`. No session and no API key: the token in the path is the only credential, and the routes are `@Public`. The frontend page `/approve/:token` is rendered outside `AuthProvider` (`main.tsx`), so it never calls `/auth/me`.
- `GET` is repeatable and never consumes the token. It answers `200` with the estimate document fields only, while the estimate can still be decided. `POST` with `decision` `APPROVE` or `DECLINE` consumes the token, moves the version to `APPROVED` or `DECLINED`, and writes one row to `workshop_estimate_approvals`, all in one transaction. One decision per version is enforced by `wea_tenant_version_uq`.
- Answers: `404` `ESTIMATE_APPROVAL_NOT_FOUND` for an unknown or malformed link. `410` `ESTIMATE_APPROVAL_UNAVAILABLE` for an expired, used or superseded link, or an expired version (a sent version past `valid_until` is marked `EXPIRED` on access). `409` `ESTIMATE_NOT_DECIDABLE` when the version is no longer `SENT` for another reason. `422` `ESTIMATE_APPROVAL_CONFIRMATION_INCOMPLETE` when an approval lacks the legal confirmation, the B2C declaration or the typed name. `429` when the per-IP throttler trips (a plain throttler answer, no code), or `ESTIMATE_APPROVAL_RATE_LIMITED` when the per-token limit trips. Every answer of the route carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`, except a body-parser error (malformed JSON or an oversized body), which Nest answers before any module middleware runs.
- Limits: per IP, 120 reads and 20 decisions a minute (`ESTIMATE_APPROVAL_IP_THROTTLER`). Per token, 60 reads and 10 decisions in ten minutes. The per-token counter lives in each process, so with several instances the effective limit is per instance. The 256-bit token is the main defence; a shared limiter is a follow-up.
- The token is looked up by the SHA-256 of the raw value through the system client (`workshopEstimateApprovalToken`, allowlisted in `system-prisma-allowlist.md`). After the lookup the request runs as the tenant the row names, and every other query goes through `PrismaService`.
- The evidence row keeps the snapshot and PDF hashes, the legal text version and hash, the typed name, the two confirmations, the recipient address, the IP, the user agent and the accept-language. Its `confirmation_email_sent_at` and `confirmation_provider_message_id` stay empty: the confirmation mail is not sent in this phase.
- The approval wording (`Kostenvoranschlag annehmen`) is a draft until the lawyer signs off (ADR-0025 §7). The page never says "digital signiert": it describes an electronic confirmation.
- Logs and error reports: the access log and the server error reporter redact the token segment (`redactRequestPath`, `redactEventPaths`). The browser error reporter does not start on `/approve/` (in any letter case), so the token never reaches it.
- Observe APM (only when `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` are set): the approval route is excluded from HTTP tracing (`buildObserveRootOptions`, `http.ignore`). Before go-live, check that Observe's error capture does not record the request URL of this route.
- Before go-live, the infrastructure request logs (Cloud Run request logs, and the Firebase Hosting rewrite of `/api/**` to Cloud Run) must exclude or redact `/api/public/estimate-approvals/` and `/approve/`. Those logs record paths outside the application. This is a condition of the AUT-373 security review.
- Audit rows for a public decision carry actor `SYSTEM` with the pseudo user `public-estimate-approval`. The customer's decision and its evidence are in `workshop_estimate_approvals`.
- `trust proxy` is set globally, so the client IP used for the per-IP limit and recorded as evidence can be spoofed through `X-Forwarded-For`. This pre-dates phase 5; a hop-count setting is a follow-up.
- `pdf_sha256` stays empty when the customer decides before the PDF archive completes. `content_sha256` always covers the decided snapshot.
- Not built yet: the three-year nulling of the IP address and the user agent in the evidence (ADR-0025 §10) has no job. Until it exists, the evidence keeps both.

## 2d. Order communication timeline (phase 6)

- `GET /api/workshop/orders/:id/communications` returns the customer side of one order as `{ "data": [...] }`, newest first, at most 100 entries. An entry is either an estimate email (`kind` `ESTIMATE_EMAIL`, channel `EMAIL`, `status` `QUEUED`, `SENT`, `FAILED` or `SUPPRESSED`) or a customer decision (`kind` `ESTIMATE_APPROVAL`, channel `LINK` or `ADVISOR_RECORDED`, `decision` `APPROVED` or `DECLINED`). `QUEUED` covers the internal `PENDING` and `SENDING`.
- The roles are the estimate roles (OWNER, ADMIN, SALES), and the order must be in the caller's site. The response carries no address, body, subject, typed name, IP address or token. The builder copies only the fields it lists (`apps/core-api/src/workshop/workshop-order-communications.ts`).
- The order detail page shows the list as **Kommunikation mit dem Kunden**, under the estimate card, for the same roles. A send refreshes it at once. The card re-reads on every mount and focus, so a customer decision appears on the next load or focus. While an email is QUEUED and was queued in the last ten minutes, the card re-reads every five seconds.

## 3. Secrets (GSM names only, no values in the repository)

Secrets are pulled through `secrets/gsm-mapping.json` (see [google-secret-manager](../../google-secret-manager.md)). Nothing is added to the example mapping until the secret exists.

| GSM secret (planned name) | Used by | Status |
|---|---|---|
| `acp-core-api-brevo-api-key` | Brevo adapter (`live`) | Not provisioned. AUT-362. |
| `acp-core-api-ses-credentials` | SES adapter (`live`) | Not provisioned. AUT-362. |
| `CLOUD_TASKS_WORKER_SECRET` | Shared worker secret (`CLOUD_TASKS_WORKER_SECRET`, mapped in `cloudbuild.yaml` and `infra/variables.tf`) | Existing. Worker service and `core-api` must hold the same value. |

The service behind `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL` needs the worker secret and, once AUT-362 lands, the provider key. The PDF worker receives none of the `NOTIFICATION_*` or `CLOUD_TASKS_NOTIFICATION_*` variables; `cloudrun-pdf-worker-notification-env.spec.ts` checks the deploy file in CI.

## 4. Enabling (not yet permitted)

1. AUT-362 closed: DPA signed, sender domain verified, provider key in GSM.
2. Create the Cloud Tasks queue `CLOUD_TASKS_NOTIFICATION_QUEUE` in the same region as the PDF queue. Grant the `CLOUD_TASKS_INVOKER_SA` `roles/run.invoker` on the service behind `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL`, and grant the `core-api` runtime service account enqueue rights on the new queue only.
3. Set `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL` to the `core-api` URL with the `/api` suffix. Do not point it at the PDF worker.
4. Keep `NOTIFICATION_EMAIL_MODE=off` in production until a sign-off names the first allowlisted test recipient. Set `live` with that single address on the allowlist, then check the first row end to end.
5. Only after the lawyer clears the copy and `CUSTOMER_ESTIMATE_SEND_ENABLED` is approved may the allowlist widen to customers.

**Never** set `fake` in production (env validation refuses it). Never put a real customer address on the allowlist in CI or UAT.

The deployed QA and UAT services run `NODE_ENV=production`, so `fake` cannot run there. Keep the mode `off` on them until AUT-362 wires a provider. A `live` deploy sends only to allowlisted recipients, and each of those fails with `PROVIDER_NOT_CONFIGURED` until then.

## 5. Checking the outbox

Statuses: `PENDING` (waiting, see `next_attempt_at`), `SENDING` (claimed, see `lease_expires_at`), `ACCEPTED` (provider accepted; v1 stops here, there are no delivery webhooks), `FAILED` (dead letter after 5 attempts or a permanent error), `SUPPRESSED` (not sent by policy).

A suspended tenant (`is_active = false`) is not claimed, so its notices stay `PENDING`. They go out after reactivation while the 7-day window lasts, and otherwise fail with `STALE_UNSENT`.

```sql
-- Dead letters for one tenant, newest first (run through a read replica or with tenant scope).
SELECT id, event_type, last_error_code, attempts, failed_at
FROM notification_outbox
WHERE tenant_id = '<tenant-id>' AND status = 'FAILED'
ORDER BY failed_at DESC
LIMIT 50;
```

`suppressed_reason` for SUPPRESSED rows: `EMAIL_DISABLED`, `RECIPIENT_NOT_ALLOWLISTED`. `last_error_code` for the rest, written by the worker today: `PROVIDER_NOT_CONFIGURED`, `MAX_ATTEMPTS_EXCEEDED`, `LEASE_EXPIRED`, `RECIPIENT_MISSING`, `RECIPIENT_INVALID`, `MESSAGE_INCOMPLETE`, `MESSAGE_INVALID`, `STALE_UNSENT`, `UNSUPPORTED_CHANNEL` (failed, no retry); `SENDER_NOT_CONFIGURED` (the from-address is unset; retried) and `UNEXPECTED_ERROR` (retried). A real adapter adds its own codes, such as `NETWORK`, `PROVIDER_5XX`, `PROVIDER_429`, `TIMEOUT` (transient) and `RECIPIENT_REJECTED` (a permanent refusal of the address, which clears `contact_email_ok` for that customer and that address).

Stored error text is generic. Provider response bodies are never stored.

## 5a. Replaying dead letters (phase 6)

- `POST /api/notifications/outbox/replay` with `{ "ids": ["<outbox-id>", ...] }`: one to 50 different ids. Owner or admin only. This is narrower than the estimate roles: a sales member and a technician both get 403.

  ```
  POST /api/notifications/outbox/replay
  Authorization: Bearer <owner or admin session token>
  Content-Type: application/json

  { "ids": ["<outbox-id>"] }
  ```

- Each FAILED row goes back to PENDING with a fresh attempt budget, and is woken once that change is committed. The answer lists `replayed` and `refused`. A refusal carries one code, and a refused row is never sent by that request. The first check that fails sets the code, in the order below:
  - `NOT_FOUND`: no such row in this tenant.
  - `NOT_FAILED`: the row is not FAILED. A row that another request has just replayed is refused this way too. A SUPPRESSED row stays suppressed.
  - `BODY_PURGED`: the 90-day purge has removed the body, so the notice cannot be sent again.
  - `STALE_UNSENT`: the row is older than the 7-day sending window. The next sweep fails such a row and clears its body (§6), so replay refuses it. The remedy is the same as for `LINK_REDACTED`.
  - `BODY_MISSING`: an email row written without a body.
  - `LINK_REDACTED`: a failed estimate email. The write that failed it removed the approval link (ADR-0025 §7), so sending the body again would send the placeholder. Send the estimate again as a new version: create a revision on the order, then send it with the customer email. The failed version stays on record, and its link stops working once the new version is sent.
- Replay never sends inline. A replayed row goes through the normal worker, so the mode and the allowlist still apply: under `off` it is recorded as SUPPRESSED. If the wake-up cannot be queued, the failure is logged and the row waits PENDING for the recovery sweep (§6).
- Fix the cause first, and read `last_error_code` (§5). Replay is safe for `PROVIDER_NOT_CONFIGURED` and `MAX_ATTEMPTS_EXCEEDED` once the provider or the sender setting is healthy. `MAX_ATTEMPTS_EXCEEDED` is what a retryable error (`UNEXPECTED_ERROR`, `SENDER_NOT_CONFIGURED`, the transient codes) leaves behind after its last attempt; the row's message names that last error. A row that failed as `LEASE_EXPIRED` may already have reached the customer (§6), so confirm with the provider first. Do not replay `RECIPIENT_MISSING` or `RECIPIENT_INVALID`: the row keeps its recipient, so the notice has to be written again.
- Replay writes no audit row yet. The change shows only in the row's `updatedAt` (§6).

## 6. Known limits (v1)

- Delivery is at least once. A crash between provider acceptance and the status write, or a status write that keeps failing after acceptance, leaves the claim to expire. The sweep then resends the notice. After the fifth attempt the sweep fails the row as `LEASE_EXPIRED` instead, so a notice that was delivered can show as a dead letter.
- No delivery webhooks and no open or click tracking (ADR-0025 §6, §7).
- A PENDING notice unsent after 7 days is failed with `STALE_UNSENT`, never sent late. The sweep re-wakes a PENDING row only after a 5-minute grace; a duplicate wake-up is harmless because claims are atomic.
- Wake-ups for retries and for rows the sweep finds come from the recovery cron, which runs only in a live instance with CPU allocated. core-api deploys with `--cpu-throttling` and `--min-instances 0`, so a quiet service can delay those until a request keeps an instance alive. The 7-day `STALE_UNSENT` backstop still holds. Phase 4 writes EMAIL rows, so before `CUSTOMER_ESTIMATE_SEND_ENABLED` is on, add a Cloud Scheduler job for the sweep, or keep CPU allocated with a minimum instance (a cost decision).
- A new row's first send is woken by a task enqueued right after the send commits (phase 4). If that task cannot be queued, the failure is logged and the row stays PENDING until the sweep wakes it after the 5-minute grace.
- A lost attempt (an expired lease) waits the same backoff as a failed send when the recovery sweep releases it. A Cloud Tasks redelivery of the same wake-up can reclaim an expired claim at once, so that resend has no backoff.
- Replay is built (§5a). It writes no audit row yet, so an admin replay leaves no entry beyond the row's `updatedAt`. An audit entry is a follow-up.
- The IP address and the user agent in the approval evidence are kept. The three-year nulling job (ADR-0025 §10) is not built (§2c).
- The `trust proxy` hop count is a follow-up (§2c). The per-IP limit and the recorded IP both depend on it.
- ADR-0025 §4 and decision D9 still say 409 for an invalid link. §7 and the code answer 404 or 410, and the code follows §7. Amending the ADR is an owner decision (§7).
- Deferred to later tickets, not in phase 6: the advisor-recorded approval (AUT-355), the overrun notice, the FAGG information and the approval confirmation email.

## 7. Go-live conditions (customer sends)

Customer estimate emails stay off until each of these holds:

1. AUT-362 is closed: the DPA, the sender domain and the provider key are in place. The first live send goes to a single allowlisted address (§4).
2. The lawyer has signed off the copy (AUT-360 D19, D23) and the approval wording (§2c).
3. Owner decision on how the recovery sweep runs: a Cloud Scheduler job, or CPU allocation with a minimum instance. Each costs money. Until one is chosen, retries and the sweep can wait for a request (§6).
4. AUT-373 security review: the Cloud Run request logs, the Firebase Hosting rewrite and Observe's error capture exclude or redact `/api/public/estimate-approvals/` and `/approve/` (§2c).
5. The `trust proxy` hop count is set for the deployed topology and verified there (§2c).
6. Owner decision on ADR-0025 §4 and D9 (409, or 404 and 410 as the code does), recorded in the ADR.
7. Owner decision on the IP and user-agent retention: the job (ADR-0025 §10) is built, or the owner accepts keeping both until it is.
8. The owner has approved `CUSTOMER_ESTIMATE_SEND_ENABLED` for customer sends (§4, step 5).
