import { ApiProperty } from '@nestjs/swagger';

/**
 * Allowed MIME types for mechanic voice-note uploads.
 * Must stay in sync with `SUPPORTED_AUDIO_MIME_TYPES` in `SpeechNoteService`.
 * Ref: https://platform.openai.com/docs/guides/speech-to-text/supported-formats
 */
export const ALLOWED_VOICE_NOTE_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/oga',
  'audio/ogg',
  'audio/wav',
  'audio/wave',
  'audio/webm',
  'audio/x-wav',
  'video/mp4',
  'video/mpeg',
  'video/webm',
]);

/**
 * Whisper API hard limit is 25 MiB.
 * ADR-0014 §5.3 — validate before provider submission.
 */
export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024; // 25 MiB

/**
 * Maximum permitted audio recording duration in seconds (5 minutes).
 * ADR-0014 §5.3 — validate before provider submission.
 * The check uses the duration reported by the provider in the verbose response;
 * an error is returned to the caller when the limit is exceeded.
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
 * Contains the translated diagnostic-note draft returned by the speech-note
 * adapter.  The draft is **not** persisted automatically — the mechanic must
 * review it and submit it via `PATCH /api/mechanic/tasks/:taskId/diagnostics`.
 *
 * ADR-0014 §5.3
 */
export class VoiceNoteDraftResponseDto {
  /**
   * Transcribed/translated note text in the canonical deployment language.
   * The mechanic should review this draft before accepting it.
   */
  @ApiProperty({
    description:
      'Transcribed and translated note draft in the canonical deployment language. ' +
      'Not persisted — the mechanic must accept it via PATCH /diagnostics.',
  })
  text!: string;

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
