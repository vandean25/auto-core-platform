# Runbook: notification email sender (AUT-356)

**Status:** Stub (phases 2 to 4 of AUT-356: the worker, the fake provider and the inert stubs ship; three German customer drafts render; the estimate send can queue its email behind `CUSTOMER_ESTIMATE_SEND_ENABLED`; no account is wired). Real provider wiring waits for [AUT-362](https://linear.app/auto-core-platform/issue/AUT-362) (DNS, DPA, sender domain). Customer sends also wait for the lawyer's sign-off on the copy (AUT-360 D19, D23) and for `CUSTOMER_ESTIMATE_SEND_ENABLED`.
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

## 2. Environment flags (defaults fail closed)

| Variable | Default | Meaning |
|---|---|---|
| `NOTIFICATION_EMAIL_MODE` | `off` | `off`: every due email is recorded as SUPPRESSED (`EMAIL_DISABLED`). `fake`: in-memory provider, rejected in production. `live`: the real provider, for allowlisted recipients only. |
| `NOTIFICATION_EMAIL_PROVIDER` | `brevo` | Used only in `live`. `brevo` (planner default) or `ses` (eu-central-1). |
| `NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST` | empty | Comma list of exact addresses or `*@domain`. Empty means nothing is sent in `live`. |
| `NOTIFICATION_EMAIL_FROM_ADDRESS` | unset | Sender on the ACP domain. Required when the mode is `fake` or `live`. |
| `CLOUD_TASKS_NOTIFICATION_QUEUE` | unset | Queue name. Unset means no wake-ups; rows wait until it is set and the sweep runs. |
| `CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL` | unset | Base URL of the service that handles wake-ups, in the same shape as `CLOUD_TASKS_TARGET_BASE_URL`. It must be a service that holds the `NOTIFICATION_*` settings. |
| `ESTIMATE_APPROVAL_BASE_URL` | unset | Public https base of the approval link in the estimate email, without a trailing slash, query or credentials (ADR-0025 §7). Required while `CUSTOMER_ESTIMATE_SEND_ENABLED` is on; the boot check refuses otherwise. |

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
- The token is 32 random bytes, base64url, inside the link only. The database keeps its SHA-256 in `workshop_estimate_approval_tokens`. It expires at the version's `valid_until`, and it is invalidated when its version is superseded. The public GET and POST route and the `/approve/:token` page come in the next phase.
- `Customer.contact_email_ok` is `false` until the advisor confirms the address, through the customer create and update endpoints. A permanent refusal of the address (`RECIPIENT_REJECTED`, a hard bounce) clears the flag for that customer and that exact address (ADR-0025 §8).
- An approval link is removed from a row's body once the row reaches `ACCEPTED`, `FAILED` or `SUPPRESSED`. A notice that was never sent (`STALE_UNSENT`) loses its body. A retry keeps the link, because it still needs the body.
- The first send is woken by a task enqueued right after its send commits. If that task cannot be queued, the recovery sweep wakes the row after its grace.

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

## 6. Known limits (v1)

- Delivery is at least once. A crash between provider acceptance and the status write, or a status write that keeps failing after acceptance, leaves the claim to expire. The sweep then resends the notice. After the fifth attempt the sweep fails the row as `LEASE_EXPIRED` instead, so a notice that was delivered can show as a dead letter.
- No delivery webhooks and no open or click tracking (ADR-0025 §6, §7).
- A PENDING notice unsent after 7 days is failed with `STALE_UNSENT`, never sent late. The sweep re-wakes a PENDING row only after a 5-minute grace; a duplicate wake-up is harmless because claims are atomic.
- Wake-ups for retries and for rows the sweep finds come from the recovery cron, which runs only in a live instance with CPU allocated. core-api deploys with `--cpu-throttling` and `--min-instances 0`, so a quiet service can delay those until a request keeps an instance alive. The 7-day `STALE_UNSENT` backstop still holds. Phase 4 writes EMAIL rows, so before `CUSTOMER_ESTIMATE_SEND_ENABLED` is on, add a Cloud Scheduler job for the sweep, or keep CPU allocated with a minimum instance (a cost decision).
- A new row's first send is woken by a task enqueued right after the send commits (phase 4). If that task cannot be queued, the sweep wakes the row only after the 5-minute grace.
- A lost attempt (an expired lease) waits the same backoff as a failed send when the recovery sweep releases it. A Cloud Tasks redelivery of the same wake-up can reclaim an expired claim at once, so that resend has no backoff.
- No replay endpoint yet (ADR-0025 lists `POST /api/notifications/outbox/replay` for a later phase).
