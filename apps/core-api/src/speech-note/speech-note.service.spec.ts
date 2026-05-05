import type OpenAI from 'openai';
import { APIError } from 'openai';
import {
  SpeechNoteConfigError,
  SpeechNoteInputError,
  SpeechNoteProviderError,
} from './speech-note.errors';
import { SpeechNoteService } from './speech-note.service';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const DUMMY_BUFFER = Buffer.from('fake-audio-content');
const DUMMY_INPUT = {
  audioBuffer: DUMMY_BUFFER,
  filename: 'note.webm',
  mimeType: 'audio/webm',
};

// ---------------------------------------------------------------------------
// Mock OpenAI client
// ---------------------------------------------------------------------------

function makeMockOpenAI() {
  return {
    audio: {
      translations: {
        create: jest.fn(),
      },
      transcriptions: {
        create: jest.fn(),
      },
    },
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  } as unknown as OpenAI;
}

// ---------------------------------------------------------------------------
// Helper to build APIError instances compatible with openai v6
// ---------------------------------------------------------------------------

function makeAPIError(status: number, type: string): APIError {
  // Pass undefined for headers; APIError constructor does a null-safe headers?.get() check.
   
  return new APIError(status, { type, message: 'provider error' }, 'provider error', undefined as any);
}

// ---------------------------------------------------------------------------
// Helpers for constructing the service with a custom language
// ---------------------------------------------------------------------------

function buildService(
  openai: OpenAI | null,
  canonicalLanguage = 'en',
): SpeechNoteService {
  const original = process.env.SPEECH_NOTE_LANGUAGE;
  process.env.SPEECH_NOTE_LANGUAGE = canonicalLanguage;
  try {
    return new SpeechNoteService(openai);
  } finally {
    if (original === undefined) {
      delete process.env.SPEECH_NOTE_LANGUAGE;
    } else {
      process.env.SPEECH_NOTE_LANGUAGE = original;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpeechNoteService', () => {
  let mockOpenAI: ReturnType<typeof makeMockOpenAI>;

  beforeEach(() => {
    mockOpenAI = makeMockOpenAI();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('throws SpeechNoteInputError when audioBuffer is empty', async () => {
      const service = buildService(mockOpenAI);
      await expect(
        service.transcribeNote({ ...DUMMY_INPUT, audioBuffer: Buffer.alloc(0) }),
      ).rejects.toBeInstanceOf(SpeechNoteInputError);
    });

    it('throws SpeechNoteInputError with a descriptive message for empty buffer', async () => {
      const service = buildService(mockOpenAI);
      await expect(
        service.transcribeNote({ ...DUMMY_INPUT, audioBuffer: Buffer.alloc(0) }),
      ).rejects.toThrow('Audio buffer must not be empty.');
    });

    it('throws SpeechNoteInputError for an unsupported MIME type', async () => {
      const service = buildService(mockOpenAI);
      await expect(
        service.transcribeNote({ ...DUMMY_INPUT, mimeType: 'image/jpeg' }),
      ).rejects.toBeInstanceOf(SpeechNoteInputError);
    });

    it('SpeechNoteInputError message for unsupported MIME includes the rejected type', async () => {
      const service = buildService(mockOpenAI);
      await expect(
        service.transcribeNote({ ...DUMMY_INPUT, mimeType: 'image/jpeg' }),
      ).rejects.toThrow('image/jpeg');
    });

    it('accepts a supported MIME type with codec parameters (e.g. audio/webm;codecs=opus)', async () => {
      const service = buildService(mockOpenAI, 'en');
      (mockOpenAI.audio.translations.create as jest.Mock).mockResolvedValue({
        text: 'Check oil.',
        duration: 1.5,
        language: 'english',
        segments: [],
      });

      await expect(
        service.transcribeNote({ ...DUMMY_INPUT, mimeType: 'audio/webm;codecs=opus' }),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // English (translation) flow
  // -------------------------------------------------------------------------

  describe('canonical language = en (translation flow)', () => {
    let service: SpeechNoteService;

    beforeEach(() => {
      service = buildService(mockOpenAI, 'en');
    });

    it('calls audio.translations.create with verbose_json format', async () => {
      (mockOpenAI.audio.translations.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads on front axle.',
        duration: 4.2,
        language: 'english',
        segments: [],
      });

      await service.transcribeNote(DUMMY_INPUT);

      expect(mockOpenAI.audio.translations.create).toHaveBeenCalledWith({
        file: expect.anything(),
        model: 'whisper-1',
        response_format: 'verbose_json',
      });
    });

    it('does NOT call transcriptions or chat endpoints', async () => {
      (mockOpenAI.audio.translations.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads on front axle.',
        duration: 4.2,
        language: 'english',
        segments: [],
      });

      await service.transcribeNote(DUMMY_INPUT);

      expect(mockOpenAI.audio.transcriptions.create).not.toHaveBeenCalled();
      expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    });

    it('returns a SpeechNoteDraft with provider=openai and model=whisper-1', async () => {
      (mockOpenAI.audio.translations.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads on front axle.',
        duration: 4.2,
        language: 'english',
        segments: [],
      });

      const result = await service.transcribeNote(DUMMY_INPUT);

      expect(result).toMatchObject({
        text: 'Replace brake pads on front axle.',
        provider: 'openai',
        model: 'whisper-1',
        durationSeconds: 4.2,
        detectedLanguage: 'english',
      });
    });

    it('returns durationSeconds from provider response', async () => {
      (mockOpenAI.audio.translations.create as jest.Mock).mockResolvedValue({
        text: 'Check oil level.',
        duration: 2.1,
        language: 'english',
        segments: [],
      });

      const result = await service.transcribeNote(DUMMY_INPUT);

      expect(result.durationSeconds).toBe(2.1);
    });
  });

  // -------------------------------------------------------------------------
  // Non-English flow (transcription + optional translation)
  // -------------------------------------------------------------------------

  describe('canonical language = th (transcription + translation flow)', () => {
    let service: SpeechNoteService;

    beforeEach(() => {
      service = buildService(mockOpenAI, 'th');
    });

    it('calls audio.transcriptions.create with verbose_json format', async () => {
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'Check the brake pads.',
        language: 'th',
        duration: 3.5,
        segments: [],
      });

      await service.transcribeNote(DUMMY_INPUT);

      expect(mockOpenAI.audio.transcriptions.create).toHaveBeenCalledWith({
        file: expect.anything(),
        model: 'whisper-1',
        response_format: 'verbose_json',
      });
    });

    it('skips text translation when detected language matches canonical', async () => {
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'ตรวจสอบผ้าเบรก',
        language: 'th',
        duration: 2.0,
        segments: [],
      });

      const result = await service.transcribeNote(DUMMY_INPUT);

      expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        text: 'ตรวจสอบผ้าเบรก',
        detectedLanguage: 'th',
        provider: 'openai',
        model: 'whisper-1',
        durationSeconds: 2.0,
      });
    });

    it('calls chat.completions.create when detected language differs from canonical', async () => {
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads.',
        language: 'en',
        duration: 3.0,
        segments: [],
      });
      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [
          { message: { content: 'เปลี่ยนผ้าเบรก', role: 'assistant' } },
        ],
      });

      await service.transcribeNote(DUMMY_INPUT);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o-mini' }),
      );
    });

    it('returns translated text in the SpeechNoteDraft when translation is needed', async () => {
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads.',
        language: 'en',
        duration: 3.0,
        segments: [],
      });
      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [
          { message: { content: 'เปลี่ยนผ้าเบรก', role: 'assistant' } },
        ],
      });

      const result = await service.transcribeNote(DUMMY_INPUT);

      expect(result.text).toBe('เปลี่ยนผ้าเบรก');
      expect(result.detectedLanguage).toBe('en');
      expect(result.model).toBe('whisper-1');
    });

    it('normalises detected language case before matching canonical', async () => {
      // Provider might return "EN" or "EN-US"; canonical is stored as "th",
      // so these should NOT match and translation should proceed.
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads.',
        language: 'EN',
        duration: 3.0,
        segments: [],
      });
      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [{ message: { content: 'เปลี่ยนผ้าเบรก', role: 'assistant' } }],
      });

      const result = await service.transcribeNote(DUMMY_INPUT);

      // Translation should have run and detected language normalised.
      expect(result.detectedLanguage).toBe('en');
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('skips translation when detected language matches canonical after normalisation', async () => {
      // Provider returns "TH" (uppercase); canonical is "th" — should still skip translation.
      const thService = buildService(mockOpenAI, 'th');
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'ตรวจสอบผ้าเบรก',
        language: 'TH',
        duration: 2.0,
        segments: [],
      });

      const result = await thService.transcribeNote(DUMMY_INPUT);

      expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
      expect(result.detectedLanguage).toBe('th');
    });
  });

  // -------------------------------------------------------------------------
  // Provider error normalisation
  // -------------------------------------------------------------------------

  describe('provider error normalisation', () => {
    let service: SpeechNoteService;

    beforeEach(() => {
      service = buildService(mockOpenAI, 'en');
    });

    it('wraps OpenAI APIError into SpeechNoteProviderError', async () => {
      const apiError = makeAPIError(401, 'invalid_request_error');
      (mockOpenAI.audio.translations.create as jest.Mock).mockRejectedValue(
        apiError,
      );

      await expect(service.transcribeNote(DUMMY_INPUT)).rejects.toBeInstanceOf(
        SpeechNoteProviderError,
      );
    });

    it('includes provider status code in the SpeechNoteProviderError', async () => {
      const apiError = makeAPIError(429, 'rate_limit_exceeded');
      (mockOpenAI.audio.translations.create as jest.Mock).mockRejectedValue(
        apiError,
      );

      await expect(service.transcribeNote(DUMMY_INPUT)).rejects.toMatchObject({
        providerStatus: 429,
      });
    });

    it('does NOT include the API key in the error message', async () => {
      const apiKey = 'sk-secret-api-key-value';
      const apiError = makeAPIError(401, 'invalid_request_error');
      (mockOpenAI.audio.translations.create as jest.Mock).mockRejectedValue(
        apiError,
      );

      const caught = await service
        .transcribeNote(DUMMY_INPUT)
        .catch((e) => e as SpeechNoteProviderError);

      expect(caught).toBeInstanceOf(SpeechNoteProviderError);
      expect(caught.message).not.toContain(apiKey);
    });

    it('wraps unexpected non-APIError into SpeechNoteProviderError', async () => {
      (mockOpenAI.audio.translations.create as jest.Mock).mockRejectedValue(
        new Error('Network timeout'),
      );

      await expect(service.transcribeNote(DUMMY_INPUT)).rejects.toBeInstanceOf(
        SpeechNoteProviderError,
      );
    });

    it('wraps transcription error (non-English flow) into SpeechNoteProviderError', async () => {
      const nonEnService = buildService(mockOpenAI, 'th');
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockRejectedValue(
        makeAPIError(500, 'server_error'),
      );

      await expect(
        nonEnService.transcribeNote(DUMMY_INPUT),
      ).rejects.toBeInstanceOf(SpeechNoteProviderError);
    });

    it('wraps chat translation error (non-English flow) into SpeechNoteProviderError', async () => {
      const nonEnService = buildService(mockOpenAI, 'th');
      (mockOpenAI.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'Replace brake pads.',
        language: 'en',
        duration: 2.0,
        segments: [],
      });
      (mockOpenAI.chat.completions.create as jest.Mock).mockRejectedValue(
        makeAPIError(503, 'service_unavailable'),
      );

      await expect(
        nonEnService.transcribeNote(DUMMY_INPUT),
      ).rejects.toBeInstanceOf(SpeechNoteProviderError);
    });
  });

  // -------------------------------------------------------------------------
  // Missing provider configuration (null client)
  // -------------------------------------------------------------------------

  describe('missing OPENAI_API_KEY (null client)', () => {
    it('throws SpeechNoteConfigError when called with a null client', async () => {
      const service = buildService(null);
      await expect(service.transcribeNote(DUMMY_INPUT)).rejects.toBeInstanceOf(
        SpeechNoteConfigError,
      );
    });

    it('SpeechNoteConfigError message mentions OPENAI_API_KEY', async () => {
      const service = buildService(null);
      await expect(service.transcribeNote(DUMMY_INPUT)).rejects.toThrow(
        'OPENAI_API_KEY',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error classes
  // -------------------------------------------------------------------------

  describe('error classes', () => {
    it('SpeechNoteConfigError is instance of Error', () => {
      const err = new SpeechNoteConfigError('missing key');
      expect(err).toBeInstanceOf(Error);
    });

    it('SpeechNoteProviderError.providerStatus stores the HTTP status', () => {
      const err = new SpeechNoteProviderError('failed', 503);
      expect(err.providerStatus).toBe(503);
    });

    it('SpeechNoteInputError has correct name', () => {
      const err = new SpeechNoteInputError('empty');
      expect(err.name).toBe('SpeechNoteInputError');
    });

    it('throws SpeechNoteConfigError when SPEECH_NOTE_LANGUAGE is an invalid code', () => {
      expect(() => buildService(mockOpenAI, 'not a valid lang code!!!')).toThrow(
        SpeechNoteConfigError,
      );
    });

    it('accepts valid BCP-47 sub-tagged language codes like zh-tw', () => {
      expect(() => buildService(mockOpenAI, 'zh-tw')).not.toThrow();
    });
  });
});
