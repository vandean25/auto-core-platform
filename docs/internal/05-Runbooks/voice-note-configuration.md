# Voice Note Configuration Runbook

_ADR-0014 §5.3 — AI Voice Notes and Translation_

This document describes all environment variables and configuration knobs that
control the mechanic voice-note feature (POST `/api/mechanic/tasks/:taskId/voice-notes`).

Transcription uses `VoiceTranslationModule` (Google Cloud Speech-to-Text and
Translate). Provider credentials are stored per tenant in Settings → Voice
Translation, not as a global OpenAI API key.

---

## Tenant provider configuration

Each tenant configures:

- Target language (BCP-47, default `de`)
- Google Cloud project ID and location (default `global`)
- Encrypted Google service-account JSON

If the tenant has no Google credential, the endpoint returns **503 Service
Unavailable** (`Google voice translation is not configured.`).

`SECRET_ENCRYPTION_KEY` (base64-encoded 32-byte key) is required to encrypt
those credentials at rest. See `apps/core-api/.env.example`.

---

## Optional Environment Variables

### `VOICE_NOTE_RATE_LIMIT_MAX`

| Property | Value |
|---|---|
| **Default** | `10` |
| **Format** | Positive integer |
| **Example** | `5` |

Maximum number of voice-note uploads permitted for a single mechanic within
one rate-limit window (`VOICE_NOTE_RATE_LIMIT_TTL_SECONDS`).

When the limit is exceeded, the endpoint returns **429 Too Many Requests** with
a retry delay in the response message.

This value is read from the environment at **call time**.  No code deploy is
required to change it, but the process must be restarted (or the container
redeployed) for the updated env var to take effect.

> **Note on multi-instance deployments:** The rate-limit counters are stored
> in the Node.js process memory of each backend instance.  In a scaled
> multi-replica deployment this provides _per-instance_ throttling, not
> _global_ throttling.  For global rate limiting, front the service with a
> reverse proxy or API gateway that enforces request limits.

---

### `VOICE_NOTE_RATE_LIMIT_TTL_SECONDS`

| Property | Value |
|---|---|
| **Default** | `60` |
| **Format** | Positive integer (seconds) |
| **Example** | `120` |

Length of the sliding window used for per-mechanic rate limiting.

A mechanic may upload at most `VOICE_NOTE_RATE_LIMIT_MAX` voice notes within
any `VOICE_NOTE_RATE_LIMIT_TTL_SECONDS`-second window.

---

## Hard-Coded Constraints

These constants are defined in the codebase and can only be changed via a code
deploy.  They are documented here for operational awareness.

| Constant | Value | File |
|---|---|---|
| `MAX_VOICE_NOTE_BYTES` | 25 MiB (26,214,400 bytes) | `apps/core-api/src/mechanic/dto/voice-note.dto.ts` |
| `MIN_VOICE_NOTE_BYTES` | 100 bytes | `apps/core-api/src/mechanic/dto/voice-note.dto.ts` |
| `MAX_VOICE_NOTE_DURATION_SECONDS` | 300 seconds (5 minutes) | `apps/core-api/src/mechanic/dto/voice-note.dto.ts` |

**MIME allow-list** (defined in `apps/core-api/src/mechanic/dto/voice-note.dto.ts`):

```
audio/webm  audio/mpeg  audio/mp3  audio/ogg  audio/wav  audio/x-wav  audio/flac
```

These correspond to the encodings `VoiceTranslationService` maps to Google
Speech (`WEBM_OPUS`, `MP3`, `OGG_OPUS`, `LINEAR16`, `FLAC`).

---

## Privacy and Logging Policy

ADR-0014 §5.3 — _Observability without content logging._

Backend application logs for the voice-note endpoint contain **only** the
following safe operational fields:

| Field | Description |
|---|---|
| `tenantId` | Tenant the request belongs to |
| `taskId` | Workshop task the note was attached to |
| `bytes` | Audio file size in bytes |
| `mimeType` | Normalised MIME type of the upload |
| `provider` | AI provider name (e.g. `google-cloud`) |
| `model` | Transcription model (e.g. `latest_long`) |
| `latencyMs` | End-to-end provider call duration in milliseconds |
| `durationSeconds` | Audio recording duration as reported by the provider |
| `failureClass` | Error class name on failure paths |

The following data **must never appear** in logs:

- Raw audio content or binary data.
- Transcript text (the transcribed or translated note content).
- API keys or provider credentials.
- Customer PII (names, contact details, vehicle identifiers).

---

## Audio Buffer Cleanup

The audio buffer held in memory is **zeroed out immediately** after
transcription completes (on both success and failure paths).  Because the
backend uses Multer's in-memory storage, no audio data is written to disk;
the zeroing ensures the buffer cannot be read from memory during garbage
collection.

---

## AI Request Payload Scope

The payload sent to Google Cloud Speech contains **only**:

- The audio file binary data.
- The recognition encoding derived from MIME type.
- Source and target language codes.

No customer data, order details, pricing information, invoice content, or other
business aggregates are included in the AI request payload.

---

## Error Response Reference

| HTTP Status | Cause |
|---|---|
| 201 Created | Transcription succeeded; draft returned |
| 403 Forbidden | Task completed, not assigned to mechanic, or non-TECH token |
| 404 Not Found | Task does not exist in the caller's tenant |
| 413 Payload Too Large | Audio file exceeds the Multer size limit (25 MiB) |
| 422 Unprocessable Entity | Bad MIME type, empty/silent audio, or duration exceeded |
| 429 Too Many Requests | Per-mechanic rate limit exceeded |
| 502 Bad Gateway | Google Speech/Translate returned an error |
| 503 Service Unavailable | Tenant Google voice translation is not configured |
