import { ApiProperty } from '@nestjs/swagger';

/**
 * Allowed MIME types for mechanic voice-note uploads.
 */
export const ALLOWED_VOICE_NOTE_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
]);

/**
 * Whisper API hard limit is 25 MiB.
 * ADR-0014 §5.3 — validate before provider submission.
 */
export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024; // 25 MiB

/**
 * Maximum permitted audio recording duration in seconds (5 minutes).
 * ADR-0014 §5.3 — validate before provider submission.
 * The backend rejects parseable over-limit recordings before provider submission
 * and keeps the provider-reported duration check as a fallback.
 */
export const MAX_VOICE_NOTE_DURATION_SECONDS = 300;

/**
 * Minimum useful audio buffer size (bytes).
 * Buffers smaller than this are treated as empty/silent and rejected.
 */
export const MIN_VOICE_NOTE_BYTES = 100;

/**
 * Response DTO for `POST /api/mechanic/tasks/:taskId/voice-notes`.
 *
 * Contains the translated diagnostic-note draft returned by the voice-translation
 * adapter. The draft is persisted immediately as `PENDING` and can later be
 * accepted via `PATCH /api/mechanic/tasks/:taskId/diagnostics`.
 *
 * ADR-0014 §5.3
 */
export class VoiceNoteDraftResponseDto {
  @ApiProperty({
    description:
      'Server-generated draft id. Pass this id to PATCH /diagnostics when accepting the voice-note draft.',
    format: 'uuid',
  })
  draftId!: string;

  /**
   * Transcribed/translated note text in the canonical deployment language.
   * The mechanic should review this draft before accepting it.
   */
  @ApiProperty({
    description:
      'Transcribed and translated note draft in the canonical deployment language. ' +
      'Persisted as a PENDING draft; mechanic acceptance via PATCH /diagnostics marks it ACCEPTED.',
  })
  text!: string;

  @ApiProperty({
    description: 'Original transcript text before translation.',
  })
  originalText!: string;

  @ApiProperty({
    description: 'Configured source language code used for speech recognition.',
  })
  sourceLanguageCode!: string;

  @ApiProperty({
    description: 'Configured target language code used for translated output.',
  })
  targetLanguageCode!: string;

  /**
   * BCP-47 language tag detected from the source audio (e.g. `"en"`, `"th"`).
   * May be absent for translation-only flows.
   */
  @ApiProperty({
    description: 'BCP-47 language code detected from the audio source.',
    type: String,
    required: false,
    nullable: true,
  })
  detectedLanguage?: string;

  /** AI provider identifier, e.g. `"openai"`. For audit logging only. */
  @ApiProperty({
    description: 'AI provider used for transcription/translation.',
    example: 'openai',
  })
  provider!: string;

  /** Model used for transcription/translation, e.g. `"whisper-1"`. */
  @ApiProperty({
    description: 'Model used for audio transcription/translation.',
    example: 'whisper-1',
  })
  model!: string;

  /** Duration of the audio recording in seconds, as reported by the provider. */
  @ApiProperty({
    description: 'Duration of the audio recording in seconds.',
    type: Number,
    required: false,
    nullable: true,
  })
  durationSeconds?: number;
}
