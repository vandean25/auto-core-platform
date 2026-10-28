---
title: "ADR-0033: Web Push for Staff Through the Notification Outbox (FCM)"
date: "2026-10-28"
status: proposed
deciders: "Dejan Dosenovic (Product Owner approved the split and the v1 event list on 2026-10-27)"
linear-project: "Mobile usability (phone)"
tags: [adr, notifications, push, pwa, privacy]
---

# ADR-0033: Web Push for Staff Through the Notification Outbox (FCM)

## Status

**Proposed — 2026-10-28.** Extends [ADR-0025](2026-10-02-customer-communication-and-approvals.md) §6 with a `PUSH` channel. ADR-0025 is otherwise unchanged. The product scope and the v1 event list were approved by the Product Owner in [AUT-766](https://linear.app/auto-core-platform/issue/AUT-766) (split out of [AUT-740](https://linear.app/auto-core-platform/issue/AUT-740)). Acceptance authorizes the design; it does not approve a production rollout, which needs the Product Owner's explicit approval when it is due.

## Context

AUT-740 delivers only the installable PWA shell: manifest, install hint and one minimal service worker. Advisors and mechanics work on phones and tablets and miss events that matter within minutes: a customer decided an estimate, a task waits for the customer, an order is ready. Today these exist only as in-app rows and realtime events, which an idle or closed app never shows.

ADR-0025 already provides what delivery needs: a transactional `NotificationOutbox` written in the same transaction as the business change, a dedicated Cloud Tasks queue, a worker that sends inside the task request (never inline, never after the response), a retry policy and a retention job. `firebase-admin` is a core-api dependency and the web app already uses the Firebase project for Auth.

## Decision Drivers

- No new queue, no new long-lived secret, no always-on CPU.
- No customer personal data in a push payload; explicit opt-in per device.
- Tenant and site isolation as for every other record (ADR-0013, ADR-0022).
- A kill switch that works without a deploy of new code.
- Small, expand-only database changes (the schema stays backward compatible with the previous revision).

## Decision

### 1. Provider: FCM web push

- The client uses `firebase/messaging` with our single service worker from AUT-740 (`getToken({ serviceWorkerRegistration })`); there is no `firebase-messaging-sw.js`. The library is loaded lazily, only from the notification settings screen.
- core-api sends with `firebase-admin` `messaging().sendEach`, authenticated by the Cloud Run service account (Application Default Credentials). The Web Push certificate (VAPID public key) and the sender id are public build variables of the web app (`VITE_FIREBASE_VAPID_PUBLIC_KEY`, `VITE_FIREBASE_MESSAGING_SENDER_ID`); an empty key means push is off in the client. No secret is added.
- On iOS 16.4+ it works for an installed PWA only.

### 2. Delivery path: the existing outbox, a new channel

- `NotificationChannel` gains `PUSH`; `notification_outbox` gains a nullable `recipient_user_id` (expand-only). IN_APP and EMAIL rows are unchanged.
- The code path that writes the IN_APP row for an event also writes, in the same transaction, one PUSH row per recipient user. The idempotency key is event + occurrence + user + `PUSH`.
- The existing Cloud Tasks wake-up and worker send to all active devices of that user inside the task request. A row is `ACCEPTED` if at least one device accepted. FCM `UNREGISTERED` and `INVALID_ARGUMENT` revoke that device; transient errors use the existing retry policy.
- A push older than 1 hour at send time is suppressed (`STALE`); the FCM time to live is 1 hour. Quiet hours are checked at send time in the site timezone and suppress the row (`QUIET_HOURS`) rather than delaying it, because the in-app record remains.
- Kill switch: the environment variable `PUSH_ENABLED`, default `false`. While it is off, PUSH rows are written as suppressed (`PUSH_DISABLED`) and nothing is sent.

### 3. Recipients (v1, internal staff only)

1. `CUSTOMER_ESTIMATE_DECIDED` (approved or declined): the advisors of the order's site; on approved also the order's assigned mechanic.
2. `WORKSHOP_TASK_WAITING_CUSTOMER`: the advisors of the order's site.
3. `WORKSHOP_ORDER_READY`: the advisors of the site. Optional, shipped last.

Recipients are resolved at write time (active tenant membership with the role, active site membership for the order's site, push enabled for that event) and the membership is checked again at send time. "Part arrived" is out of v1 because no domain event exists for it.

### 4. Data model (expand-only, `tenant_id` on every row)

- `push_devices`: id, tenant, user, FCM token (unique per tenant), coarse platform (ios, android or desktop plus browser family, never the full user agent), installed flag, created and last-seen timestamps, revoked timestamp and reason.
- `push_preferences`: tenant, user (unique pair), the enabled event types (empty by default), quiet hours as minutes of the day (nullable means none).
- A daily in-process job revokes devices not seen for 60 days and hard-deletes revoked rows after 30 days. A device is also removed when a membership is deactivated or the user is deleted. Sending never runs in the job.

### 5. API and client

- `GET`, `POST` and `DELETE /api/v1/me/push/devices`, `GET` and `PUT /api/v1/me/push/preferences`, and `POST /api/v1/me/push/test`, which enqueues a test push to the caller's own devices through the same outbox and worker path and is limited to 5 per hour. Everything is scoped to the caller's own user and active tenant; another user's device is a 404. OpenAPI first.
- Settings → Notifications, per device: the permission is requested only from a button press, never on load; per-event toggles; quiet hours; test push; device list with removal. iOS without installation shows the install instructions; a denied permission explains how to re-enable it. On sign-out and on a tenant switch the client deletes the current registration and registers again for the new tenant.
- The service worker always shows a notification for a push (Safari revokes silent pushes) and on click focuses an existing tab or opens the same-origin deep link `/workshop/orders/{id}`.

### 6. Privacy

- The payload carries no customer data: no name, phone, e-mail or plate. It contains a generic localized title and body in the recipient's language, the order id for the deep link and a collapse tag. A test pins the payload to an allowlist of keys.
- Opt-in is explicit per device and can be withdrawn at any time. The stored data is limited to employee device data (token, coarse platform, timestamps) and is deleted as above. The privacy documentation and the records of processing get an entry for FCM (Google is already a Firebase subprocessor).

### 7. Rollout

- The migration is expand-only. Production setup (FCM API, Web Push certificate, send role for the service account, the two build variables) is done by Infra on QA first and needs the Product Owner's approval for production. Until then `PUSH_ENABLED` stays `false` and the client treats an empty VAPID key as push off.

## Consequences

### Positive

- Reuses the outbox, queue, worker, retry and retention of ADR-0025: no new infrastructure and no new secret.
- Sends happen inside the task request, so nothing runs after the response.
- Privacy by construction: the payload cannot carry customer data, and devices are removable by the user and by cleanup.

### Negative

- Delivery is best effort: FCM acceptance, not receipt, is recorded. A suppressed or stale push is not retried; the in-app record is the fallback.
- Web push on iOS requires an installed PWA and an explicit permission, so coverage there depends on staff installing the app.
- Two more tenant-scoped tables to maintain, and the deletion policy gains two entities.

### Neutral

- Customer-facing push, broadcast or admin push, offline data, background sync and native apps stay out of scope.

## Alternatives Considered

| Option                                           | Pros                                                        | Cons                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| FCM web push via the Firebase SDK (chosen)       | Same Firebase project, free, no new secret, ADC for sending | Depends on Google as a delivery provider                                                           |
| Self-managed VAPID with the `web-push` library   | No third-party SDK                                          | A long-lived private key in Secret Manager with rotation, our own endpoint and encryption handling |
| Send from the mutation handler or after response | Simpler to write                                            | Violates ADR-0025 (no inline sends) and the AUT-763 lesson; lost sends on instance shutdown        |
| A separate push queue                            | Isolated limits                                             | New infrastructure for tiny volume                                                                 |

## References

- [ADR-0025](2026-10-02-customer-communication-and-approvals.md) §6 (outbox and notification bus), [ADR-0013](2026-04-15-row-level-multi-tenancy.md), [ADR-0022](2026-08-31-site-operational-scope.md)
- [AUT-766](https://linear.app/auto-core-platform/issue/AUT-766) and the SE design comment "Part B: Push" on [AUT-740](https://linear.app/auto-core-platform/issue/AUT-740)

---

## Linear Tracking

| Field     | Value                               |
| --------- | ----------------------------------- |
| Project   | Mobile usability (phone)            |
| Milestone | —                                   |
| Issues    | AUT-766 (follows AUT-740, the PWA shell) |
