---
title: "ADR-0030: Wear OS standalone watch for mechanic voice capture"
date: "2026-10-16"
status: proposed
deciders: "Product Owner, Architecture Team"
linear-project: "https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b"
linear-milestone: "Agent-assisted findings and transactional channels"
tags:
  - adr
  - workshop
  - security
  - voice
---

# ADR-0030: Wear OS standalone watch for mechanic voice capture

## Status

**Proposed** — 2026-10-16. Implements the platform decision for [AUT-517](https://linear.app/auto-core-platform/issue/AUT-517/spec-first-watch-spracherfassung-mit-sicherem-task-pairing-und-offline). The contract, fixtures, and follow-up issue are the feature spec [watch voice capture](../02-Feature-Specs/Workshop/watch-voice-capture.md).

This decision extends [ADR-0014](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) §5.3. It does not change the browser voice-note limits, the `WorkshopVoiceNoteDraft` acceptance enum, or the Firebase session used by `core-web`. It follows [ADR-0013](2026-04-15-row-level-multi-tenancy.md) and [ADR-0022](2026-08-31-site-operational-scope.md): tenant and site come from the authenticated browser session at pairing time, never from the watch.

## Context

Mechanics can already record a diagnostic note in the browser. `useVoiceNote` uploads a `MediaRecorder` blob to `POST /api/mechanic/tasks/:taskId/voice-notes`. `MechanicVoiceNoteService` checks the task, calls the tenant's Google Cloud Speech-to-Text credential, and stores a `PENDING` draft. The mechanic accepts that draft on the task page. There is no watch client, no device pairing, and no offline record id.

A watch that held the mechanic's password, recorded from the background, or chose the task id at upload time could attach a recording to the wrong order after the assignment changed. A phone-bridged companion would put the audio on a second device that is not the confirmation surface. The confirmation surface stays the existing browser review.

## Decision Drivers

- One public SDK path whose encoded audio is already in the voice-note MIME allow-list (`audio/ogg` → `OGG_OPUS`).
- The watch must work when the phone is absent. Core authentication, recording, and upload are watch functions.
- No persistent user password on the watch. The browser session that already exists mints a short-lived grant.
- A recording made offline keeps the task id the server issued before the microphone opened. Upload cannot move that audio onto another task.
- The smallest storage that makes revocation, expiry, and idempotent retry true. No new speech provider and no new draft status.

## Decision

1. The only watch client is a **standalone Wear OS app**. The manifest sets `com.google.android.wearable.standalone` to `true`. The watch talks HTTPS to `core-api` on Wi-Fi or LTE. It does not use the Wear OS Data Layer, a phone app, or watchOS.
2. The browser, signed in as the technician, mints a one-time pairing code. The watch exchanges that code for a grant token `wvp_<pairingId>_<secret>`. The watch stores the grant in app-private storage, encrypted with an Android Keystore key. It never stores a user password, a Firebase refresh token, or the pairing code.
3. Before the microphone starts, the watch must hold an unexpired server **capture permit** for one task. The permit freezes `workshop_task_id`, `workshop_order_id`, and an assignment fingerprint of the two mechanic ids. The order id is not inside the fingerprint. The upload route reads the task from the permit row. A client-supplied task id that disagrees is a conflict, and the audio is not attached anywhere. A stored upload row is returned before those checks run again.
4. Each local recording has a client `record id`. The server stores one `WatchVoiceUpload` row per tenant and record id. A retry with the same bytes returns the first result and does not call Speech-to-Text again. A retry with different bytes or a different task does not create a draft.
5. Speech-to-Text stays the existing tenant Google credential and `VoiceTranslationService`. The watch sends mono Ogg Opus only. The browser MIME allow-list and the 25 MiB / 300 s limits stay as they are.
6. The watch never receives transcript text. The existing task-detail Accept control loads the `PENDING` draft and sends `voiceNoteDraftId` with the notes. No new acceptance status.

Named test devices, store access, and the STT probe are prerequisites in the feature spec. This ADR does not buy hardware, upload a store build, or add a production auth client.

## Consequences

### Positive

- Lost device, expiry, tenant switch, and a changed assignment are server states. The watch cannot keep a working password after revoke.
- Offline audio is bound to one permit. Closing the task or moving the assignment rejects the upload and does not retarget it.
- The browser review remains the only place a transcript is accepted.
- Ogg Opus is already mapped to `OGG_OPUS`. No new encoding is added to the provider call.

### Negative

- Mechanics with an Apple Watch are outside this decision until a later ADR. Their browser and phone review is unchanged.
- A pairing lasts one shift (12 hours) and does not refresh. The mechanic pairs again on the next shift.
- Ogg duration is not parsed today (`readAudioDurationSeconds` handles WebM only). The watch route has to reject an Ogg Opus file longer than 90 seconds before Speech-to-Text.

### Neutral

- `WorkshopTask` statuses do not change. Pairing and permits use their own rows and timestamps.
- Dashboard real-time sync does not gain these tables. The queue page refetches after pair and revoke.

## Alternatives Considered

| Option | Pros | Cons |
| --- | --- | --- |
| Wear OS standalone (chosen) | Public microphone API, Ogg Opus sample, no phone required for core functions, direct HTTPS | Wear OS only. Play internal testing is a later prerequisite |
| Wear OS non-standalone companion (Data Layer to a phone app) | Phone can hold the Firebase session | Core upload depends on a phone. Audio sits on a second device. Google marks this non-standalone and hides it from untethered watches. The browser, not the phone, is the confirmation surface |
| watchOS independent app | Public `AVAudioRecorder` | Typical files are MPEG-4 AAC. `audio/mp4` is not in `ALLOWED_VOICE_NOTE_MIME_TYPES`. A second store and a second audio decoder for one workshop |
| Copy the Firebase session onto the watch | No new tables | Stores a user credential on the watch. No frozen task binding and no record id |

## Validation

- The feature spec's synthetic probes are the acceptance tests for pairing expiry, revoke, tenant switch, assignment change, task close, duplicate delivery, and the watch projection.
- A later device pass on a Pixel Watch 4 and a Galaxy Watch Ultra (2025) confirms the microphone starts only from the capture screen and stops when that screen pauses. This ADR does not require that pass to be proposed.

## Pragmatic Enforcer Analysis

Pragmatic mode is on (`docs/internal/.architecture/config.yml`, balanced). Security and data-integrity exemptions apply to the grant hash and the task binding. They do not apply to a second platform.

| Assessment | Score | Evidence |
| --- | --- | --- |
| Necessity | 8 | AUT-517 requires one platform, revocable pairing, offline retry, and a binding that cannot follow a changed task. Waiting leaves those rules unstated for whoever builds the client |
| Complexity | 5 | Four small tables, one grant guard, one narrower task DTO. Reuses voice-note transcription, draft acceptance, and the browser review. No phone app, no new STT vendor, no new draft status |
| Ratio | 0.63 | Under the 1.5 threshold |

Simpler alternative that was rejected: skip the permit table and trust the task id in the upload. That is smaller, and it fails the offline rule, because the queued request can name a different task after the mechanic is reassigned.

Recommendation: **Approve with the simplifications already in the decision.** Defer watchOS, a phone companion, Play production release, and a refresh-token family. Those are recorded in `docs/internal/.architecture/deferrals.md`.

## References

- Feature spec: [watch-voice-capture](../02-Feature-Specs/Workshop/watch-voice-capture.md)
- [ADR-0014](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) §5.3 voice notes
- [ADR-0026](2026-10-09-public-api-keys.md) grant-hash pattern (separate pepper, not API keys)
- Wear OS standalone: <https://developer.android.com/training/wearables/apps/standalone-apps>
- Wear OS voice recording: <https://developer.android.com/training/wearables/user-input/voice>
- MediaRecorder foreground microphone rule: <https://developer.android.com/media/platform/mediarecorder>
- Android Keystore: <https://developer.android.com/privacy-and-security/keystore>
- Speech-to-Text `OGG_OPUS`: <https://docs.cloud.google.com/speech-to-text/docs/encoding>

---

## Linear Tracking

| Field | Value |
| --- | --- |
| Project | [Customer Communication & Approvals](https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b) |
| Milestone | Agent-assisted findings and transactional channels |
| Issues | [AUT-517](https://linear.app/auto-core-platform/issue/AUT-517/spec-first-watch-spracherfassung-mit-sicherem-task-pairing-und-offline) |
