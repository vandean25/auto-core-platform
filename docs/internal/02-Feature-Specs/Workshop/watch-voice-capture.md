---
title: "Watch voice capture"
date: "2026-10-16"
module: "Workshop"
status: draft
linear-project: "https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b"
linear-milestone: "Agent-assisted findings and transactional channels"
tags:
  - feature-spec
  - workshop
  - voice
---

# Watch voice capture

## Summary

A mechanic records a short diagnostic note on a watch and accepts the transcript later on the existing browser task page. The watch is a standalone Wear OS client with a shift-long pairing grant, an explicit record button, and one server-issued task permit. Offline audio keeps the record id and the permit. Upload cannot move that audio onto another order. Browser and phone review stay as they are. Architecture: [ADR-0030](../../01-ADR/2026-10-16-wear-os-standalone-watch-voice.md).

This spec does not ship a watch binary, a store listing, a hardware purchase, or a production auth client.

---

## User Stories

- As a **mechanic**, I want to **start and stop a recording on my watch for the task I already selected** so that **I can speak a diagnostic note without leaving the bay**.
- As a **mechanic**, I want to **accept that transcript on the task page I already use** so that **the note is saved only after I have read it**.
- As a **workshop**, I want a **lost watch, an expired pairing, a tenant switch, or a reassigned task to drop the recording** so that **audio never lands on the wrong order**.

---

## Decisions

| ID | Decision |
| --- | --- |
| D1 | One platform: standalone Wear OS. Manifest `com.google.android.wearable.standalone=true`. No phone companion and no watchOS app. |
| D2 | The microphone runs only inside the resumed capture activity, after a tap on Record. No foreground service, complication, tile, or assistant session starts the microphone. |
| D3 | The watch stores a grant token, not a user password. Pairing codes are single-use and are not kept on the watch. |
| D4 | A capture permit freezes the task and the order. The upload reads the task from that row. |
| D5 | `clientRecordId` is the offline retry key. The same bytes replay. Different bytes or a different task do not create a second draft. |
| D6 | The watch response has no transcript. Accept stays on `DiagnosticsSection` in the browser. |
| D7 | Speech-to-Text stays the tenant Google credential already used by `MechanicVoiceNoteService`. |

---

## Platform

Standalone Wear OS is the only target. Google's packaging guide defines a standalone app as one whose core functions, including authentication, work on the watch without a phone, declared with `com.google.android.wearable.standalone` ([Standalone versus non-standalone Wear OS apps](https://developer.android.com/training/wearables/apps/standalone-apps), [Package and distribute Wear OS apps](https://developer.android.com/training/wearables/packaging)). The official Wear OS voice page says microphone capture uses `MediaRecorder` the same way a phone does, and points at the Wear Speaker sample, which has no companion phone app ([Voice input](https://developer.android.com/training/wearables/user-input/voice), [WearSpeakerSample](https://github.com/android/wear-os-samples/tree/main/WearSpeakerSample)). That sample records Ogg Opus. `audio/ogg` is already in `ALLOWED_VOICE_NOTE_MIME_TYPES` and maps to Google `OGG_OPUS` ([Speech-to-Text encodings](https://docs.cloud.google.com/speech-to-text/docs/encoding)).

A non-standalone app depends on a phone for a core function and is not offered on an untethered watch. The Data Layer would also park the audio on the phone. The confirmation surface is the browser, so the phone bridge adds a device without becoming the review UI.

watchOS `AVAudioRecorder` is a public API and is not the target. Its common recording is MPEG-4 AAC. `audio/mp4` is not accepted by `validateAudioFile`. The controller's OpenAPI prose mentions MP4; the allow-list in `voice-note.dto.ts` does not. The watch follows the allow-list.

### Named test devices

Both devices run Wear OS 6. The emulator is not the acceptance device.

| Role | Device |
| --- | --- |
| Primary | Google Pixel Watch 4, 45 mm, Wi-Fi |
| Second OEM | Samsung Galaxy Watch Ultra (2025), Wi-Fi |

### Later test prerequisites

These are named access needs for the implementation issue's device pass. This spec does not obtain them.

| Access | What is required | What this spec does not do |
| --- | --- | --- |
| Device | The two watches above, each with a screen lock (PIN or pattern) | Buy or ship hardware |
| Developer | Android Studio with the Wear OS 6 system image, `adb`, and a Google account on the watch | Sideload a binary from this spec |
| Store | A Play Console app on the **internal testing** track when a later build is shared with those accounts ([Play internal testing](https://support.google.com/googleplay/android-developer/answer/9845334)) | Production release, public listing, or any upload from AUT-517 |
| STT | The tenant setting already documented in [voice-note-configuration](../../05-Runbooks/voice-note-configuration.md): encrypted Google service-account JSON, project, location | A new provider, a new API key in the repo, or a live call in CI |

CI uses the synthetic probes and a mocked `VoiceTranslationService`. A manual speech probe, after the devices exist, uses the generated 440 Hz Ogg file against the pilot tenant credential. It is not a recording of a person. The only customer label allowed in fixtures is **pilot customer**, and that string is asserted absent from the watch payload.

---

## Capture contract

### Who may pair

`POST /api/mechanic/watch-pairings` runs in the existing Firebase session. `MechanicIdentityService.resolveMechanic()` must succeed: role `TECH`, active `MECHANIC` employee in the session tenant. `SiteContextService.getSiteId()` must succeed. The grant stores that tenant and that site. The watch never sends a tenant id, a site id, or an employee id.

One active grant per mechanic and tenant. When a new code is redeemed, the previous active grant is revoked with reason `SUPERSEDED`.

### Pairing

1. The queue page asks for a device label, default `Watch`, matching `^[A-Za-z0-9][A-Za-z0-9 .'-]{0,39}$`.
2. The server draws an 8-digit code with a CSPRNG (rejection sampling, not modulo bias). It stores only the scrypt hash. The code TTL is 5 minutes. Five wrong attempts lock the challenge.
3. The browser shows the code once. A second GET does not return it.
4. The watch sends `challengeId`, `code`, and `deviceLabel` to `POST /api/mechanic/watch/pair` with no bearer token.
5. The response token is `wvp_<pairingId>_<64 hex chars>`. `pairingId` is the row id. The secret is 32 random bytes. The response is the only time the secret exists in clear text.
6. Hash: scrypt of `<pairingId>:<secret>`, salt = `WATCH_GRANT_PEPPER`, N = 4096, r = 8, p = 1, keylen = 32, hex. Same cost as [ADR-0026](../../01-ADR/2026-10-09-public-api-keys.md) and a **different** pepper. If the pepper is unset, minting a code returns **503**. Verification failure is **401** `PAIRING_INVALID` for a bad code, a locked challenge, or a bad secret.
7. Grant TTL is 12 hours from redemption. There is no refresh token and no sliding expiry.

The watch writes the token with an AES/GCM key that lives only in the Android Keystore (`AndroidKeyStore`) ([Keystore](https://developer.android.com/privacy-and-security/keystore)). App-private files only. The watch never asks for an email or a password. After the exchange, the pairing code is wiped from watch memory.

`KeyguardManager.isDeviceSecure()` must be true before pairing or recording. A watch with no screen lock gets a local error and no grant.

### Explicit recording

`RECORD_AUDIO` is requested the first time the mechanic taps Record, from the resumed capture activity. Android 9 and later do not give the microphone to a background app; a background capture receives silence unless the app uses a foreground service ([MediaRecorder](https://developer.android.com/media/platform/mediarecorder)). This client does not start a foreground service, so a paused activity cannot keep the microphone.

| Event | Result |
| --- | --- |
| Tap Record while a permit is cached and unexpired | `MediaRecorder.start()` |
| Tap Stop while still resumed | File is closed and queued |
| 90 second cap while still resumed | Recorder stops and the file is queued |
| `onPause`, including screen off | If the recorder is running, stop it, delete the partial file, do not queue it |
| No cached permit, or permit `expiresAt` has passed | Record stays disabled. The watch does not invent a task |

WorkManager may upload a **closed** file when a network is present ([WorkManager](https://developer.android.com/topic/libraries/architecture/workmanager)). Unique work name = `clientRecordId`, existing-work policy `KEEP`. WorkManager does not start the microphone.

### Assigned task and offline binding

While online, the watch loads `GET /api/mechanic/watch/tasks` and the mechanic picks one row. `POST /api/mechanic/watch/capture-permits` with that `taskId` returns a permit. The watch caches **one** permit. Changing task requires a new online permit. Offline, the only recordable task is that cached permit.

The permit stores:

- `workshop_task_id`
- `workshop_order_id`
- `assignment_fingerprint` = `<orderId>:<task.mechanic_id or empty>:<order.mechanic_id or empty>`
- `expires_at` = 8 hours from issue, and not later than the grant expiry
- `max_uploads` = 3

Assignment matches the rules in `assertTaskAssignedToMechanic`: the task mechanic is this employee, or the task mechanic is null and the order mechanic is this employee. Task status must be `NOT_STARTED`, `IN_PROGRESS`, or `WAITING_PARTS`. `DONE` is refused at permit time with **403**.

The local manifest, one file per recording, is:

```json
{
  "clientRecordId": "66666666-6666-4666-8666-666666666666",
  "permitId": "55555555-5555-4555-8555-555555555555",
  "taskId": "22222222-2222-4222-8222-222222222222",
  "sha256": "<hex of the ogg bytes>",
  "bytes": 12345,
  "mimeType": "audio/ogg",
  "state": "queued"
}
```

`clientRecordId` is a UUID created on the watch when the file is closed. `state` is `queued`, `uploading`, `accepted`, or `rejected`. The watch does not edit `taskId` after the file is closed.

Upload sends `permitId`, `clientRecordId`, and the audio. The server loads the permit. It ignores any task id in the body except to compare it: if the body contains `taskId` and it differs from `permit.workshop_task_id`, the result is **409** `RECORD_TASK_MISMATCH` and no draft. The attach target is always `permit.workshop_task_id` after the checks below. There is no retarget API.

| Check at upload | Failure code | HTTP | Draft |
| --- | --- | --- | --- |
| Grant missing, bad secret | `PAIRING_INVALID` | 401 | no |
| `expires_at` passed | `PAIRING_EXPIRED` | 401 | no |
| `revoked_at` set, or lost-device revoke | `PAIRING_REVOKED` | 401 | no |
| `User.active_tenant_id` ≠ grant tenant | `TENANT_MISMATCH` | 401 | no |
| Employee inactive, or membership no longer `TECH` | `ROLE_REVOKED` | 401 | no |
| Site membership for the grant site inactive | `SITE_INACTIVE` | 401 | no |
| Permit expired | `PERMIT_EXPIRED` | 409 | no |
| `upload_count` already 3 | `PERMIT_EXHAUSTED` | 409 | no |
| Task status `DONE` | `TASK_CLOSED` | 409 | no |
| Fingerprint differs | `ASSIGNMENT_CHANGED` | 409 | no |
| Task `workshop_order_id` ≠ permit order | `ORDER_CHANGED` | 409 | no |
| Body `taskId` ≠ permit task | `RECORD_TASK_MISMATCH` | 409 | no |

`TENANT_MISMATCH`, `ROLE_REVOKED`, and `SITE_INACTIVE` also set `revoked_at` on that request, so switching the browser back does not revive the grant. The mechanic pairs again. Tenant switch already clears `active_site_id` ([ADR-0022](../../01-ADR/2026-08-31-site-operational-scope.md)); the watch does not learn the new tenant from a header.

A 401 or a 409 from this table moves the local manifest to `rejected` and deletes the audio file. The watch does not offer another task for those bytes. A new take needs a new permit (when the failure is a stale permit) and a new `clientRecordId`.

`PERMIT_EXPIRED` is deliberately strict. A recording that missed the 8 hour window is not attached even if the same mechanic is still assigned. The mechanic records again after a fresh permit.

### Duplicate delivery

`WatchVoiceUpload` is unique on `(tenant_id, client_record_id)`.

| Replay | Result |
| --- | --- |
| Same id, same SHA-256, first result was a draft | **200**, `replay: true`, same `draftId`. Speech-to-Text is not called again |
| Same id, same SHA-256, first result was a binding 409 | **409** with the stored `failureCode`. No second provider call |
| Same id, different SHA-256 or different permit task | **409** `RECORD_CONFLICT`. The first draft stays the only draft |

**502**, **503**, and **429** do not insert the unique row. The watch keeps the file and retries the same id. **422** inserts a `REJECTED` row with the audio failure code so a bad file is not retried into a provider call, and the watch deletes the file.

The browser route `POST /api/mechanic/tasks/:taskId/voice-notes` is unchanged. It does not accept a watch grant.

### Watch screen

The watch renders only `sequence`, `taskTitle`, `taskStatus`, and `bayName`, plus pairing and record/stop/upload state. It does not render a transcript, a customer, a price, a plate, a VIN, an order number, notes, or the complaint. The watch task query must not select those columns. `taskTitle` is the task's own title (the probe title is `Front brake pads`). The string **pilot customer** must not appear in any watch response. Browser task detail still returns plate and VIN; the watch does not call that route.

### Browser confirmation

`useVoiceNote` today keeps the draft only in component state after an in-page upload, and Accept writes `mechanicNotes` without `voiceNoteDraftId`. A watch draft is already a `PENDING` row the page never loads. The implementation closes that gap on the existing controls:

1. Opening the task calls `GET /api/mechanic/tasks/:taskId/voice-note-drafts/pending` with the Firebase session. **200** returns the oldest `PENDING` draft for this mechanic and task, using `VoiceNoteDraftResponseDto`. **204** means there is nothing to review.
2. `useVoiceNote` shows that `text` in the existing draft state. It does not auto-merge it into the notes.
3. Accept cancels the notes debounce and sends one `PATCH /api/mechanic/tasks/:taskId/diagnostics` with `mechanicNotes` (the edited text) and `voiceNoteDraftId`. `processVoiceNoteDraft` moves the row `PENDING` → `ACCEPTED` with the existing `updateMany` guard.
4. The page refetches the pending route. The next oldest draft, if any, is shown the same way.
5. When a server `draftId` is present, Discard is not shown. Clearing the sentence and then Accepting saves the notes the mechanic left and still marks the draft `ACCEPTED`, so it is not offered again. The draft row keeps `original_text` and `translated_text`. No `REJECTED` status.

The watch never calls the diagnostics route.

---

## Audio format

Watch uploads are `multipart/form-data`, field name `audio`, plus fields `permitId` and `clientRecordId`. `Idempotency-Key` is required and must equal `clientRecordId`.

| Property | Watch | Existing browser route |
| --- | --- | --- |
| MIME | `audio/ogg` only | Current allow-list, unchanged |
| Container / codec | Ogg Opus | Unchanged |
| Channels | 1 | Unchanged |
| Sample rate | 16000 Hz | Unchanged |
| Bit rate | 24000 bps | Unchanged |
| Max duration | 90 seconds | 300 seconds |
| Max size | 1 MiB (1,048,576 bytes) | 25 MiB |
| Min size | 100 bytes | 100 bytes |

`MediaRecorder` settings, which the Wear OS voice guide delegates to the platform recorder:

- `AudioSource.MIC`
- `OutputFormat.OGG`
- `AudioEncoder.OPUS`
- `setAudioChannels(1)`
- `setAudioSamplingRate(16000)`
- `setAudioEncodingBitRate(24000)`

The server reads the Ogg Opus identification-header input sample rate. It must be one of 8000, 12000, 16000, 24000, or 48000, matching `OGG_OPUS` ([encoding](https://docs.cloud.google.com/speech-to-text/docs/encoding)). Anything else is **422** `AUDIO_SAMPLE_RATE` before the provider call. Duration is the last Ogg page granule position divided by 48000. Above 90 seconds is **422** `AUDIO_TOO_LONG`, and the buffer is zeroed. Missing granule data is **422** `AUDIO_DURATION_UNREADABLE`. `readAudioDurationSeconds` today returns `undefined` for Ogg; the watch path must not treat that as "duration ok".

The provider call stays `VoiceTranslationService` with encoding `OGG_OPUS` and `sampleRateHertz` from that header. No customer, price, or order text is added to the provider payload. Logs follow the existing voice-note runbook and may add `clientRecordId`, `permitId`, and `failureCode`. Logs must not include audio bytes, transcript text, the pairing code, the grant secret, or customer fields.

Rate limit: a watch upload that reaches the provider counts in the existing `VoiceNoteRateLimit` for that mechanic. Replays do not.

---

## Database Impact

### New Tables / Columns

Additive migration only. No change to `WorkshopVoiceNoteDraft` columns or to `WorkshopVoiceNoteDraftStatus`.

| Table | Column | Type | Nullable | Notes |
| --- | --- | --- | --- | --- |
| `watch_pairing_challenges` | `id` | uuid | no | Primary key |
| `watch_pairing_challenges` | `tenant_id` | uuid | no | FK tenant, `ON DELETE CASCADE` |
| `watch_pairing_challenges` | `site_id` | uuid | no | FK site, `ON DELETE RESTRICT` |
| `watch_pairing_challenges` | `mechanic_employee_id` | uuid | no | FK employee, `ON DELETE RESTRICT` |
| `watch_pairing_challenges` | `code_hash` | text | no | scrypt hex. Clear-text code is not stored |
| `watch_pairing_challenges` | `hash_version` | int | no | `1` |
| `watch_pairing_challenges` | `expires_at` | timestamptz | no | 5 minutes from insert |
| `watch_pairing_challenges` | `consumed_at` | timestamptz | yes | Set when redeemed or locked |
| `watch_pairing_challenges` | `failed_attempts` | int | no | Default 0. Lock at 5 |
| `watch_pairings` | `id` | uuid | no | Public lookup id inside `wvp_` |
| `watch_pairings` | `tenant_id`, `site_id`, `mechanic_employee_id` | uuid | no | Same delete rules as the challenge |
| `watch_pairings` | `secret_hash` | text | no | scrypt hex |
| `watch_pairings` | `hash_version` | int | no | `1` |
| `watch_pairings` | `expires_at` | timestamptz | no | 12 hours from redemption |
| `watch_pairings` | `revoked_at` | timestamptz | yes | Null while active |
| `watch_pairings` | `revoked_reason` | enum | yes | `LOST_DEVICE`, `TENANT_SWITCH`, `SUPERSEDED`, `MANUAL`, `ROLE_REVOKED`, `SITE_INACTIVE` |
| `watch_pairings` | `device_label` | varchar(40) | no | Not a customer name |
| `watch_pairings` | `last_used_at` | timestamptz | yes | Updated at most once per 5 minutes |
| `watch_capture_permits` | `id` | uuid | no | |
| `watch_capture_permits` | `tenant_id`, `site_id`, `mechanic_employee_id`, `watch_pairing_id` | uuid | no | Pairing FK `ON DELETE RESTRICT` |
| `watch_capture_permits` | `workshop_task_id`, `workshop_order_id` | uuid | no | Task FK `ON DELETE CASCADE` |
| `watch_capture_permits` | `assignment_fingerprint` | text | no | Frozen at issue |
| `watch_capture_permits` | `expires_at` | timestamptz | no | 8 hours, capped by the grant |
| `watch_capture_permits` | `upload_count` | int | no | Default 0 |
| `watch_capture_permits` | `max_uploads` | int | no | Default 3 |
| `watch_voice_uploads` | `id` | uuid | no | |
| `watch_voice_uploads` | `tenant_id` | uuid | no | |
| `watch_voice_uploads` | `client_record_id` | uuid | no | Unique with `tenant_id` |
| `watch_voice_uploads` | `watch_pairing_id`, `permit_id` | uuid | no | |
| `watch_voice_uploads` | `workshop_task_id`, `workshop_order_id` | uuid | no | Copied from the permit. Task FK `ON DELETE CASCADE` |
| `watch_voice_uploads` | `status` | enum | no | `ACCEPTED` or `REJECTED` |
| `watch_voice_uploads` | `failure_code` | text | yes | Required when `REJECTED` |
| `watch_voice_uploads` | `voice_note_draft_id` | uuid | yes | Set when a draft was created. `ON DELETE SET NULL` |
| `watch_voice_uploads` | `byte_length` | int | no | |
| `watch_voice_uploads` | `content_sha256` | char(64) | no | Lower hex of the raw audio |

Indexes: `(tenant_id, mechanic_employee_id)` on pairings; `(tenant_id, watch_pairing_id)` on permits; unique `(tenant_id, client_record_id)` on uploads; `(tenant_id, workshop_task_id)` on uploads.

`last_used_at` writes are not per request in a loop. One update when the stored timestamp is older than five minutes.

### Modified Tables

| Table | Change | Migration Required? |
| --- | --- | --- |
| `WorkshopVoiceNoteDraft` | None. Watch success inserts a `PENDING` row through the existing save path | No |
| `VoiceNoteRateLimit` | None. Watch provider calls use the same counter | No |
| Employee hard-delete guard | Implementation adds the four new tables to the 409 reason list beside `WorkshopVoiceNoteDraft` | No schema change beyond the FKs |

### Deletion Policy Impact

New entities. The implementation PR adds these rows to `docs/deletion-policy.md` in the same change as the migration. They are specified here so that PR does not invent them.

| Entity | Rule |
| --- | --- |
| `WatchPairingChallenge` | No API delete. Clear-text code is never stored. A daily cleanup may delete rows whose `expires_at` is older than 24 hours. Tenant purge cascades. Employee hard-delete stays blocked (`RESTRICT`) and the 409 copy lists this table. |
| `WatchPairing` | No API delete. Revoke sets `revoked_at` and `revoked_reason`. Rows remain until tenant purge (`CASCADE`) so a presented token still resolves as revoked. Employee hard-delete stays blocked. |
| `WatchCapturePermit` | No API delete. Expiry is `expires_at`. Task delete cascades the permit. Employee hard-delete stays blocked. |
| `WatchVoiceUpload` | No API delete. Idempotency and rejection evidence. Task delete cascades the upload. Draft delete sets `voice_note_draft_id` null. Employee hard-delete stays blocked. Rejected rows with no draft follow the task's life; they are not a second retention job in this slice. |

### State machines

`WorkshopTask` and `WorkshopVoiceNoteDraft` transitions are unchanged (`PENDING` → `ACCEPTED` only).

Pairing is not a workshop status. Active means `revoked_at` is null and `expires_at` is in the future. Revoke and expiry are terminal for that grant.

Permit validity is `expires_at` in the future, `upload_count < max_uploads`, fingerprint unchanged, order id unchanged, task not `DONE`.

### Real-time sync

Do not add these models to `SUPPORTED_ENTITY_TYPES` or `dashboard-entity-map.ts`. The queue page refetches its pairing query after mint and revoke. Task-detail review refetches the pending draft after Accept. A watch upload does not need a live dashboard card.

### Inventory and finance

No stock mutation, no invoice, no fiscal date, no document number.

### System Prisma

Token verification looks up `watchPairing` by id before a tenant context exists. That is the only system-client read. The implementation adds `watchPairing` to `SYSTEM_PRISMA_MODEL_DELEGATES` and to [system-prisma-allowlist](../../05-Runbooks/system-prisma-allowlist.md), with the caller named. Every later query uses `PrismaService` and the tenant on the row. The watch must not pass tenant id.

`WATCH_GRANT_PEPPER` follows the same secret loading pattern as `API_KEY_PEPPER` (GSM, then env). It is not committed.

---

## API Contract Changes

Watch routes accept only `Authorization: Bearer wvp_...`. Firebase session routes reject a `wvp_` token with **401**. A Firebase token on a watch route is **401**. The grant guard is not a second way into `MechanicController` task routes.

### New Endpoints

| Method | Route | Request Body | Response | Auth |
| --- | --- | --- | --- | --- |
| `POST` | `/api/mechanic/watch-pairings` | `{ deviceLabel?: string }` | **201** `{ challengeId, code, expiresAt }` | Firebase `TECH` mechanic, active site |
| `GET` | `/api/mechanic/watch-pairings` | — | **200** `{ data: [{ pairingId, deviceLabel, expiresAt, revokedAt, lastUsedAt }] }` | Firebase `TECH` mechanic |
| `POST` | `/api/mechanic/watch-pairings/:pairingId/revoke` | `{ reason: "LOST_DEVICE" \| "MANUAL" }` | **204** | Firebase `TECH` mechanic. Pairing must be this mechanic and this tenant |
| `POST` | `/api/mechanic/watch/pair` | `{ challengeId, code, deviceLabel }` | **201** `{ token, expiresAt, siteName }` | Pairing code. No bearer |
| `DELETE` | `/api/mechanic/watch/pair` | — | **204** revokes the presented grant, reason `MANUAL` | Watch grant |
| `GET` | `/api/mechanic/watch/tasks` | — | **200** `{ data: [{ taskId, sequence, taskTitle, taskStatus, bayName }] }` | Watch grant |
| `POST` | `/api/mechanic/watch/capture-permits` | `{ taskId }` | **201** `{ permitId, taskId, sequence, taskTitle, taskStatus, bayName, expiresAt, maxUploads }` | Watch grant |
| `POST` | `/api/mechanic/watch/voice-notes` | multipart `audio`, `permitId`, `clientRecordId`. Header `Idempotency-Key` | **201** `{ clientRecordId, draftId, status: "ACCEPTED" }` or **200** `{ replay: true, clientRecordId, draftId, status: "ACCEPTED" }` | Watch grant |
| `GET` | `/api/mechanic/tasks/:taskId/voice-note-drafts/pending` | — | **200** `VoiceNoteDraftResponseDto` or **204** | Firebase `TECH` mechanic, task assigned |

Error bodies use `{ statusCode, failureCode, message, clientRecordId? }`. `message` is a fixed sentence. It does not include a customer, a price, or a suggested replacement task id.

`siteName` on pair is the site's name, not a customer.

At most five challenges per mechanic per hour. The sixth returns **429**.

### Modified Endpoints

| Method | Route | Change Description |
| --- | --- | --- |
| `PATCH` | `/api/mechanic/tasks/:taskId/diagnostics` | No server change. The browser Accept path must send `voiceNoteDraftId` together with `mechanicNotes` |
| `POST` | `/api/mechanic/tasks/:taskId/voice-notes` | Unchanged contract. Watch clients do not call it |

### OpenAPI Regeneration

The implementation issue runs both commands and commits both artifacts. This spec does not.

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

The new browser controls sit on the mechanic queue page (`/mechanic/queue`), which already uses the mechanic shell. Pair and revoke are page actions and go **top-right**. The top-left stays the queue title. The watch is not a web page: it uses a record button and a stop button, not a DataTable.

The transcript review stays in `DiagnosticsSection` on the task page. Accept remains the existing control. Notes on that page keep the 750 ms debounce. Accept itself is one explicit save, not a second debounce, and it cancels a pending debounce so the draft id cannot be dropped.

### Layout & Actions

- [x] Queue-page Pair and Revoke actions are top-right.
- [x] Top-left stays the queue title.
- [x] The queue header keeps `text-2xl font-semibold tracking-tight`.
- [x] Subtitle stays `text-slate-500` where the queue already has one.

### List Pages (if applicable)

- [x] Not a new list page. The watch task list is five fields and has no create button, no price column, and no row delete.
- [x] The existing mechanic queue is unchanged aside from the top-right pair actions.

### Form Handling

- [x] The pairing code is not a form that auto-saves. Revoke is an explicit button.
- [x] Diagnostic notes keep debounced auto-save. Accept of a voice draft is one `PATCH` that includes `voiceNoteDraftId`.

### Real-Time Sync

- [x] No new `SUPPORTED_ENTITY_TYPES` entry. These rows are not dashboard cards.
- [x] No `dashboard-entity-map.ts` entry.

---

## Component Design

No watch UI code is in this repository today. The implementation issue adds the HTTP client behavior; the Wear OS activities below are the client contract, built only when the test devices are available. They are not a second product surface for prices or customers.

| Component | Location | Purpose |
| --- | --- | --- |
| `WatchPairingActions` | `apps/core-web/src/features/mechanic-queue/` | Top-right Pair and Revoke on the queue page. Shows the one-time code. Does not show the grant secret |
| Pending-draft hydration | `apps/core-web/src/features/mechanic-task-detail/hooks/useVoiceNote.ts` | Loads the oldest `PENDING` draft and keeps `draftId` for Accept |
| Accept save | `useDiagnosticsAutosave` / `useVoiceNote` | One diagnostics `PATCH` with `mechanicNotes` and `voiceNoteDraftId` |
| Capture activity | Wear OS module in the follow-up issue | Record and Stop only. Releases the microphone in `onPause` |
| Task list activity | Wear OS module | Renders the five-field projection. Record stays disabled until a permit is cached |

---

## Testing Plan

Synthetic probes live in [watch-voice-capture.probes.json](fixtures/watch-voice-capture.probes.json). IDs in that file are the fixture ids. The audio probe is a 1 second 440 Hz Ogg Opus tone generated with the `ffmpeg` command in the fixture. CI does not call Google. The speech mock returns `Synthetic brake pad note.`

Existing tests that stay green without being weakened:

- `apps/core-api/test/mechanic-voice-note.e2e-spec.ts` — browser upload behavior stays
- `apps/core-web/src/pages/mechanic/MechanicTaskDetailPage.test.tsx` — extend, do not relax

### Backend E2E

New file `apps/core-api/test/watch-voice-capture.e2e-spec.ts`, one case per probe id:

- [ ] `pair-ok` stores no password and returns a `wvp_` token once.
- [ ] `pairing-expired`, `lost-device-revoke`, and `tenant-switch` return 401 and create no draft.
- [ ] `assignment-revoked-while-offline`, `task-closed-while-offline`, and `order-changed-while-offline` return 409 and leave `WorkshopVoiceNoteDraft` count unchanged. A second POST with the same `clientRecordId` does not call the speech mock again.
- [ ] `duplicate-delivery` returns 200 with the same `draftId` and `replay: true`.
- [ ] `record-conflict` keeps a single draft.
- [ ] `watch-projection-hides-pilot-customer` asserts the forbidden keys and the absence of `pilot customer`.
- [ ] `audio-bounds` covers size, MIME, and a 91 second Ogg.
- [ ] `browser-accepts-existing-review` marks the draft `ACCEPTED` only through diagnostics.

Also assert a `wvp_` token on `POST /api/mechanic/tasks/:taskId/voice-notes` is **401**, and a Firebase token on `POST /api/mechanic/watch/voice-notes` is **401**.

### Frontend

- [ ] `MechanicTaskDetailPage.test.tsx` loads a pending draft, shows `Synthetic brake pad note.` in the existing review, and Accept sends `voiceNoteDraftId`.
- [ ] Queue page test: Pair is top-right and the code is not written to `localStorage`.
- [ ] Visual check of the queue pair dialog and the task-page review after the implementation, on a desktop width. The watch UI is checked on the named devices, not in the browser.

### Device pass (blocked on the prerequisites)

On Pixel Watch 4 and Galaxy Watch Ultra (2025), with a debug or internal-track build:

- Record starts only after the tap, and `onPause` deletes a partial take.
- Airplane mode queues one file. Restoring the network uploads that `clientRecordId` once.
- After the browser revokes the grant, the next upload is 401 and the local file is gone.

---

## Synthetic probe fixtures

The probe file is the contract for the e2e names above. Summary:

| Probe | Result |
| --- | --- |
| `pair-ok` | 201 grant. Watch does not keep the code or a password |
| `pairing-expired` | 401 `PAIRING_EXPIRED`, local queue deleted |
| `lost-device-revoke` | 401 `PAIRING_REVOKED`, no draft |
| `tenant-switch` | 401 `TENANT_MISMATCH`, grant revoked `TENANT_SWITCH` |
| `assignment-revoked-while-offline` | 409 `ASSIGNMENT_CHANGED`, `attachedTaskId` null |
| `task-closed-while-offline` | 409 `TASK_CLOSED`, no draft on the closed task or any other |
| `order-changed-while-offline` | 409 `ORDER_CHANGED` |
| `duplicate-delivery` | 200 replay, one speech call |
| `record-conflict` | 409, still one draft |
| `watch-projection-hides-pilot-customer` | Five fields only. Body does not contain `pilot customer` |
| `audio-bounds` | 422 / 413 as listed |
| `browser-accepts-existing-review` | Draft `ACCEPTED` from the existing diagnostics patch |

---

## Follow-up implementation issue

File this as one issue after this spec is accepted. Do not start it from AUT-517.

**Title:** Implement Wear OS watch voice capture contract

**Scope**

- Prisma models, enums, and one additive migration for the four tables in this spec. Run `tools/tenant-restore/generate-tenant-restore-sql.mjs`. Add the deletion-policy rows and the `watchPairing` system-Prisma allow-list line.
- `WATCH_GRANT_PEPPER` fail-closed, documented in `apps/core-api/.env.example` with no secret value.
- Endpoints in this spec. Watch upload calls `MechanicVoiceNoteService` after the permit checks, with the watch audio bounds. Ogg duration is enforced. Idempotency runs before Speech-to-Text.
- Browser: queue pair/revoke, pending-draft GET, Accept sends `voiceNoteDraftId`.
- Tests listed above, including `synthetic-440hz.ogg` generated by the fixture command. Red-green. Do not weaken `mechanic-voice-note.e2e-spec.ts`.
- Regenerate OpenAPI and `apps/core-web` API types. Commit both.
- A Wear OS module whose activities match the capture contract, installed with `adb` on the two named devices when those devices and Play internal-testing access exist. No production store upload.

**Out of that issue**

- watchOS, a phone Data Layer companion, a second STT vendor, hardware purchasing, production Play release, a Firebase auth client on the watch, refresh tokens, a `REJECTED` draft status, and agent tools. `HUMAN_ONLY` actions stay excluded. This is not an `AgentProposal`.

**Done when**

- Every probe id is an automated test except the two-device pass, which is a written note on the issue once the watches are in hand.
- A closed or reassigned task cannot gain a draft from a queued watch file.
- The watch binary, if built, has no screen that shows a customer or a price.

---

## Open Questions

None. D1–D7 and the probe file are the closed contract. watchOS, a phone companion, and a long-lived refresh token are deferred in [deferrals](../../.architecture/deferrals.md), not left open inside this spec.

---

## References

- [ADR-0030](../../01-ADR/2026-10-16-wear-os-standalone-watch-voice.md)
- [ADR-0014](../../01-ADR/2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) §5.3
- [ADR-0022](../../01-ADR/2026-08-31-site-operational-scope.md)
- [Voice note configuration](../../05-Runbooks/voice-note-configuration.md)
- [Probes](fixtures/watch-voice-capture.probes.json)
- `apps/core-api/src/mechanic/mechanic.controller.ts`
- `apps/core-api/src/mechanic/mechanic-identity.service.ts`
- `apps/core-api/src/mechanic/mechanic-voice-note.service.ts`
- `apps/core-web/src/features/mechanic-task-detail/hooks/useVoiceNote.ts`
- Wear OS standalone: <https://developer.android.com/training/wearables/apps/standalone-apps>
- Wear OS voice input: <https://developer.android.com/training/wearables/user-input/voice>
- MediaRecorder: <https://developer.android.com/media/platform/mediarecorder>
- Android Keystore: <https://developer.android.com/privacy-and-security/keystore>
- WorkManager: <https://developer.android.com/topic/libraries/architecture/workmanager>
- Speech-to-Text encodings: <https://docs.cloud.google.com/speech-to-text/docs/encoding>
- Play Console internal testing: <https://support.google.com/googleplay/android-developer/answer/9845334>

---

## Linear Tracking

| Field | Value |
| --- | --- |
| Project | [Customer Communication & Approvals](https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b) |
| Milestone | Agent-assisted findings and transactional channels |
| Issues | [AUT-517](https://linear.app/auto-core-platform/issue/AUT-517/spec-first-watch-spracherfassung-mit-sicherem-task-pairing-und-offline) |
