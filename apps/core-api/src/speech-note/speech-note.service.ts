import { Inject, Injectable, Logger } from '@nestjs/common';
import type OpenAI from 'openai';
import { toFile } from 'openai';
import type { TranslationVerbose } from 'openai/resources/audio/translations';
import type { TranscriptionVerbose } from 'openai/resources/audio/transcriptions';
import { APIError } from 'openai';
import {
  SpeechNoteConfigError,
  SpeechNoteInputError,
  SpeechNoteProviderError,
} from './speech-note.errors';
import type {
  SpeechNoteDraft,
  TranscribeAudioInput,
} from './speech-note.types';

export const SPEECH_NOTE_OPENAI_CLIENT = Symbol('SPEECH_NOTE_OPENAI_CLIENT');

/** Whisper model used for audio transcription and translation. */
const AUDIO_MODEL = 'whisper-1';

/** GPT model used for text-level translation when canonical language is not English. */
const TEXT_TRANSLATION_MODEL = 'gpt-4o-mini';

/** Regex that matches valid BCP-47 language subtags (e.g. "en", "th", "zh-TW"). */
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/**
 * MIME types accepted by the OpenAI Whisper endpoint.
 * Requests with any other MIME type are rejected early as {@link SpeechNoteInputError}
 * so controller code can distinguish a bad client upload from a provider failure.
 *
 * Ref: https://platform.openai.com/docs/guides/speech-to-text/supported-formats
 */
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
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
 * Backend adapter for mechanic voice-note transcription and translation.
 *
 * ADR-0014 §5.3 — provider credentials must remain server-only; the browser
 * must never call any AI provider directly.
 *
 * ### Canonical language behaviour
 * - **English (`en`)**: Uses the OpenAI Audio *translation* endpoint, which
 *   always outputs English and handles any source language automatically.
 * - **Other languages**: First transcribes the audio via the *transcription*
 *   endpoint (preserving the source language), then — if the detected source
 *   language differs from the canonical language — performs a text-level
 *   translation using a chat completion.
 *
 * ### Logging policy
 * Raw transcript text and audio content are **never** logged to prevent
 * accidental exposure of sensitive mechanic speech.
 */
@Injectable()
export class SpeechNoteService {
  private readonly logger = new Logger(SpeechNoteService.name);
  private readonly canonicalLanguage: string;

  constructor(
    /**
     * Injected OpenAI client. May be `null` when OPENAI_API_KEY is not
     * configured; in that case, `transcribeNote()` will throw
     * {@link SpeechNoteConfigError} instead of failing at module bootstrap.
     */
    @Inject(SPEECH_NOTE_OPENAI_CLIENT)
    private readonly openai: OpenAI | null,
  ) {
    const lang = (process.env.SPEECH_NOTE_LANGUAGE ?? 'en')
      .toLowerCase()
      .trim();
    if (!LANGUAGE_CODE_RE.test(lang)) {
      throw new SpeechNoteConfigError(
        `SPEECH_NOTE_LANGUAGE "${lang}" is not a valid BCP-47 language code. ` +
          'Use a two- or three-letter ISO 639-1/639-2 tag, e.g. "en", "th", "zh-tw".',
      );
    }
    this.canonicalLanguage = lang;
  }

  /**
   * Transcribes (and optionally translates) a mechanic voice note.
   *
   * @param input - Audio buffer + metadata. The buffer is kept in memory only
   *   for the duration of this call and is never persisted.
   * @returns A {@link SpeechNoteDraft} in the configured canonical language.
   *
   * @throws {SpeechNoteConfigError} When OPENAI_API_KEY is not configured.
   * @throws {SpeechNoteInputError} When the audio buffer is empty.
   * @throws {SpeechNoteProviderError} When the AI provider returns an error.
   */
  async transcribeNote(input: TranscribeAudioInput): Promise<SpeechNoteDraft> {
    if (!this.openai) {
      throw new SpeechNoteConfigError(
        'OPENAI_API_KEY environment variable is required for speech-note processing. ' +
          'Configure this variable on the server; never expose it to the browser.',
      );
    }

    if (!input.audioBuffer || input.audioBuffer.length === 0) {
      throw new SpeechNoteInputError('Audio buffer must not be empty.');
    }

    // Validate MIME type early so controller code can distinguish a bad client
    // upload (SpeechNoteInputError → 400) from an upstream failure (SpeechNoteProviderError → 502).
    const normalizedMime = input.mimeType.split(';')[0].trim().toLowerCase();
    if (!SUPPORTED_AUDIO_MIME_TYPES.has(normalizedMime)) {
      throw new SpeechNoteInputError(
        `Unsupported audio format "${input.mimeType}". ` +
          `Supported MIME types: ${[...SUPPORTED_AUDIO_MIME_TYPES].join(', ')}.`,
      );
    }

    const file = await toFile(input.audioBuffer, input.filename, {
      type: input.mimeType,
    });

    if (this.canonicalLanguage === 'en') {
      return this.translateToEnglish(this.openai, file);
    }
    return this.transcribeAndTranslate(this.openai, file);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Uses the Whisper translation endpoint which always outputs English. */
  private async translateToEnglish(
    openai: OpenAI,
    file: Awaited<ReturnType<typeof toFile>>,
  ): Promise<SpeechNoteDraft> {
    try {
      const response = (await openai.audio.translations.create({
        file,
        model: AUDIO_MODEL,
        response_format: 'verbose_json',
      })) as TranslationVerbose;

      return {
        text: response.text,
        detectedLanguage: response.language || undefined,
        provider: 'openai',
        model: AUDIO_MODEL,
        durationSeconds: response.duration,
      };
    } catch (error) {
      throw this.normaliseProviderError(error);
    }
  }

  /**
   * Transcribes audio preserving the source language, then performs a
   * text-level translation to the canonical language when needed.
   */
  private async transcribeAndTranslate(
    openai: OpenAI,
    file: Awaited<ReturnType<typeof toFile>>,
  ): Promise<SpeechNoteDraft> {
    let rawText: string;
    let detectedLanguage: string | undefined;
    let durationSeconds: number | undefined;

    try {
      const transcription = (await openai.audio.transcriptions.create({
        file,
        model: AUDIO_MODEL,
        response_format: 'verbose_json',
      })) as TranscriptionVerbose;

      rawText = transcription.text;
      detectedLanguage = transcription.language;
      durationSeconds = transcription.duration;
    } catch (error) {
      throw this.normaliseProviderError(error);
    }

    // Skip translation when source already matches the canonical language.
    // Normalise both sides to lower-case so provider variants like "EN" or
    // "en-US" are handled the same as the canonical tag stored in lower-case.
    const normalizedDetected = detectedLanguage?.trim().toLowerCase();
    if (normalizedDetected === this.canonicalLanguage) {
      return {
        text: rawText,
        detectedLanguage: normalizedDetected,
        provider: 'openai',
        model: AUDIO_MODEL,
        durationSeconds,
      };
    }

    let translatedText: string;
    try {
      const chatResponse = await openai.chat.completions.create({
        model: TEXT_TRANSLATION_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a translator. Translate the following mechanic workshop note into ${this.canonicalLanguage}. Return only the translated text without any commentary.`,
          },
          { role: 'user', content: rawText },
        ],
      });
      translatedText =
        chatResponse.choices[0]?.message?.content?.trim() ?? rawText;
    } catch (error) {
      throw this.normaliseProviderError(error);
    }

    return {
      text: translatedText,
      detectedLanguage: normalizedDetected,
      provider: 'openai',
      // Always report the audio transcription model — Whisper always processes
      // the audio regardless of whether a text-level translation follows.
      model: AUDIO_MODEL,
      durationSeconds,
    };
  }

  /**
   * Maps a provider SDK error to a stable {@link SpeechNoteProviderError}.
   *
   * The error message is sanitised — it contains only the HTTP status and
   * the provider error code/type. Raw request payloads, API keys, and
   * full response bodies are explicitly excluded to prevent secret leakage.
   */
  private normaliseProviderError(error: unknown): SpeechNoteProviderError {
    if (error instanceof APIError) {
      // Log only non-sensitive metadata (no keys, no payloads, no bodies).
      this.logger.warn(
        `Speech-note provider error: status=${error.status} type=${error.type ?? 'unknown'}`,
      );
      return new SpeechNoteProviderError(
        `Audio processing failed (provider: openai, status: ${error.status ?? 'unknown'}).`,
        typeof error.status === 'number' ? error.status : undefined,
      );
    }

    if (error instanceof SpeechNoteConfigError) {
      throw error;
    }

    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(`Speech-note unexpected error: ${name}`);
    return new SpeechNoteProviderError(
      'Audio processing failed due to an unexpected error.',
    );
  }
}
