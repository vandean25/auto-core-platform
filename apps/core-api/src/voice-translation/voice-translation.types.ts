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

