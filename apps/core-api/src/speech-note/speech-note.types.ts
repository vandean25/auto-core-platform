/**
 * Raw audio input for the speech-note adapter.
 * Audio is treated as transient — it is never persisted by this layer.
 */
export interface TranscribeAudioInput {
  /** Raw audio buffer to transcribe/translate. Must not be empty. */
  audioBuffer: Buffer;
  /**
   * Original filename including extension (e.g. `note.webm`).
   * Used by the provider to detect the audio format.
   */
  filename: string;
  /** MIME type of the audio file (e.g. `audio/webm`, `audio/mpeg`). */
  mimeType: string;
}

/**
 * Normalised output returned by {@link SpeechNoteService}.
 * The `text` field is in the canonical note language configured for the deployment.
 */
export interface SpeechNoteDraft {
  /** Transcribed/translated note text in the canonical language. */
  text: string;
  /**
   * BCP-47 language tag detected from the source audio, when available
   * (e.g. `"en"`, `"th"`, `"fr"`). May be absent for translation-only flows.
   */
  detectedLanguage?: string;
  /** AI provider identifier, e.g. `"openai"`. Suitable for audit logging. */
  provider: string;
  /** Model used for transcription/translation, e.g. `"whisper-1"`. Suitable for audit logging. */
  model: string;
  /** Duration of the audio in seconds, when reported by the provider. */
  durationSeconds?: number;
  /**
   * Normalised confidence score in [0, 1] when the provider reports it.
   * Currently unused by Whisper endpoints; reserved for future providers.
   */
  confidence?: number;
}
