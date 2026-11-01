export interface VoiceTranslationRequest {
  audioBuffer: Buffer;
  filename: string;
  mimeType: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
}

export interface VoiceTranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
  detectedLanguageCode?: string;
  provider: string;
  model: string;
  durationSeconds?: number;
}

/** Speech-only result used by the advisor command surface. */
export interface VoiceTranscriptResult {
  transcript: string;
  sourceLanguageCode: string;
  detectedLanguageCode?: string;
  provider: string;
  model: string;
}
