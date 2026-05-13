import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_SPEECH_NOTE_MIME_TYPES } from '../../speech-note/speech-note.service';

/**
 * Allowed MIME types for mechanic voice-note uploads.
 * Reuses the authoritative list from `SpeechNoteService`.
 * Ref: https://platform.openai.com/docs/guides/speech-to-text/supported-formats
 */
export const ALLOWED_VOICE_NOTE_MIME_TYPES: ReadonlySet<string> = SUPPORTED_SPEECH_NOTE_MIME_TYPES;

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
