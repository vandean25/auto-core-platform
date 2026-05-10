# Voice Note Configuration Runbook

_ADR-0014 §5.3 — AI Voice Notes and Translation_

This document describes all environment variables and configuration knobs that
control the mechanic voice-note feature (POST `/api/mechanic/tasks/:taskId/voice-notes`).

---

## Required Environment Variables

### `OPENAI_API_KEY`

| Property | Value |
|---|---|
| **Required** | Yes (feature is disabled if absent) |
| **Format** | OpenAI API key string |
| **Example** | `sk-…` |

The backend passes this key to the OpenAI Audio API for Whisper transcription
and translation.  It is never forwarded to the browser or serialised into any
API response.

If this variable is absent, the endpoint returns **503 Service Unavailable**
with the message _"Voice-note transcription is not available."_.

---

## Optional Environment Variables

### `SPEECH_NOTE_LANGUAGE`

| Property | Value |
|---|---|
| **Default** | `en` |
| **Format** | BCP-47 language subtag, e.g. `en`, `th`, `zh-TW` |

The canonical note language for the workshop.  Transcribed audio is translated
to this language before it is returned to the mechanic.

- When set to **`en`**: the Whisper `translations` endpoint is used, which
  always produces English output regardless of the spoken source language.
- When set to **any other BCP-47 tag**: the Whisper `transcriptions` endpoint
  is used first (preserving the source language), and a GPT chat completion
  translates the text when the detected language differs from the canonical
  language.

Restart the backend after changing this value.

---

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

This value is read from the environment at **call time**, so it can be changed
without a restart in most container platforms (provided the env var is updated
in the running container and the process re-reads it — see note on memory
state below).

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
| `MAX_VOICE_NOTE_BYTES` | 25 MiB (26,214,400 bytes) | `src/mechanic/dto/voice-note.dto.ts` |
| `MIN_VOICE_NOTE_BYTES` | 100 bytes | `src/mechanic/dto/voice-note.dto.ts` |
| `MAX_VOICE_NOTE_DURATION_SECONDS` | 300 seconds (5 minutes) | `src/mechanic/dto/voice-note.dto.ts` |

**MIME allow-list** (defined in `src/speech-note/speech-note.service.ts`):

```
audio/flac  audio/m4a   audio/mp3   audio/mp4   audio/mpeg
audio/mpga  audio/oga   audio/ogg   audio/wav   audio/wave
audio/webm  audio/x-wav video/mp4   video/mpeg  video/webm
```

These correspond to the formats accepted by the OpenAI Whisper endpoint.

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
| `provider` | AI provider name (e.g. `openai`) |
| `model` | Transcription model (e.g. `whisper-1`) |
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

The payload sent to the OpenAI Audio API contains **only**:

- The audio file binary data.
- The filename (e.g. `voice-note.webm`).
- The MIME type.
- The model name (`whisper-1`).

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
| 502 Bad Gateway | OpenAI API returned an error |
| 503 Service Unavailable | `OPENAI_API_KEY` not configured |
