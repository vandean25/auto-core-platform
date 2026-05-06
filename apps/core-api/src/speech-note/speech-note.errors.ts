/**
 * Base class for all speech-note domain errors.
 * Controller code should catch these and map them to appropriate HTTP responses.
 */
export class SpeechNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when required provider configuration (e.g. OPENAI_API_KEY) is missing
 * or when an environment variable value is invalid (e.g. a malformed
 * SPEECH_NOTE_LANGUAGE code). Callers should map this to HTTP 503.
 */
export class SpeechNoteConfigError extends SpeechNoteError {
  constructor(message: string) {
    super(message);
  }
}

 * Thrown when the AI provider returns an error (e.g. API key invalid,
 * rate limit exceeded, internal provider failure). Callers should map
 * this to HTTP 502 (Bad Gateway).
 * The message is sanitised — it must not contain API keys, raw request
 * payloads, or other sensitive provider data.
export class SpeechNoteProviderError extends SpeechNoteError {
  constructor(
    message: string,
    /** HTTP status code returned by the provider, if available. */
    public readonly providerStatus?: number,
  ) {
    super(message);
  }
}

/**
 * Thrown when the caller supplies invalid or unsupported audio input
 * (e.g. empty buffer, unsupported format).
 */
export class SpeechNoteInputError extends SpeechNoteError {
  constructor(message: string) {
    super(message);
  }
}
