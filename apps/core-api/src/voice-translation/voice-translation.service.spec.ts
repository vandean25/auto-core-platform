import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceTranslationService } from './voice-translation.service';

const mockLongRunningRecognize = jest.fn();
const mockTranslateText = jest.fn();
const mockSpeechClientCtor = jest.fn();
const mockTranslationClientCtor = jest.fn();

jest.mock('@google-cloud/speech', () => ({
  SpeechClient: jest.fn().mockImplementation(() => {
    mockSpeechClientCtor();
    return {
      longRunningRecognize: mockLongRunningRecognize,
    };
  }),
}));

jest.mock('@google-cloud/translate', () => ({
  TranslationServiceClient: jest.fn().mockImplementation(() => {
    mockTranslationClientCtor();
    return {
      translateText: mockTranslateText,
    };
  }),
}));

describe('VoiceTranslationService', () => {
  const tenantId = 'tenant-1';
  const key = Buffer.alloc(32, 7).toString('base64');

  const mockPrisma = {
    voiceTranslationSettings: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  } as unknown as PrismaService;

  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
  } as unknown as TenantContextService;

  let service: VoiceTranslationService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_ENCRYPTION_KEY = key;
    (
      mockPrisma.voiceTranslationSettings.upsert as jest.Mock
    ).mockImplementation(
      ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const merged = { ...create, ...update };
        return {
          id: 'settings-1',
          target_language_code: (merged.target_language_code as string) ?? 'de',
          google_project_id:
            (merged.google_project_id as string | null) ?? null,
          google_location: (merged.google_location as string) ?? 'global',
          google_service_account_encrypted:
            (merged.google_service_account_encrypted as string | null) ?? null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
    );
    service = new VoiceTranslationService(mockPrisma, mockTenantContext);
  });

  it('returns synthesized defaults in getSettings() when no row exists', async () => {
    (
      mockPrisma.voiceTranslationSettings.findFirst as jest.Mock
    ).mockResolvedValue(null);

    const result = await service.getSettings();

    expect(result.targetLanguageCode).toBe('de');
    expect(result.googleLocation).toBe('global');
    expect(result.hasGoogleCredential).toBe(false);
    expect(mockPrisma.voiceTranslationSettings.upsert).not.toHaveBeenCalled();
  });

  it('throws on updateSettings when googleServiceAccountJson is malformed', async () => {
    await expect(
      service.updateSettings({
        googleServiceAccountJson: '{"broken"',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores encrypted credential on updateSettings()', async () => {
    (mockPrisma.voiceTranslationSettings.upsert as jest.Mock).mockResolvedValue(
      {
        id: 'settings-1',
        target_language_code: 'de',
        google_project_id: 'my-project',
        google_location: 'global',
        google_service_account_encrypted: 'ciphertext',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    );

    await service.updateSettings({
      googleProjectId: 'my-project',
      googleServiceAccountJson: JSON.stringify({
        client_email: 'service@project.iam.gserviceaccount.com',
        private_key: 'secret',
        project_id: 'my-project',
      }),
    });

    const upsertCall = (mockPrisma.voiceTranslationSettings.upsert as jest.Mock)
      .mock.calls[0][0];
    expect(upsertCall.update.google_service_account_encrypted).toMatch(/^v1:/);
  });

  it('falls back to default target language when no settings row exists', async () => {
    (
      mockPrisma.voiceTranslationSettings.findFirst as jest.Mock
    ).mockResolvedValue(null);

    await expect(service.getTargetLanguageCode(tenantId)).resolves.toBe('de');
  });

  it('throws ServiceUnavailableException when credential is missing', async () => {
    (
      mockPrisma.voiceTranslationSettings.findFirst as jest.Mock
    ).mockResolvedValue({
      google_project_id: 'my-project',
      google_location: 'global',
      google_service_account_encrypted: null,
    });

    await expect(
      service.translateVoiceNote({
        audioBuffer: Buffer.from('audio'),
        filename: 'note.webm',
        mimeType: 'audio/webm',
        sourceLanguageCode: 'de-DE',
        targetLanguageCode: 'de',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when stored credential format is invalid', async () => {
    (
      mockPrisma.voiceTranslationSettings.findFirst as jest.Mock
    ).mockResolvedValue({
      google_project_id: 'my-project',
      google_location: 'global',
      google_service_account_encrypted: 'invalid-format',
    });

    await expect(
      service.translateVoiceNote({
        audioBuffer: Buffer.from('audio'),
        filename: 'note.webm',
        mimeType: 'audio/webm',
        sourceLanguageCode: 'de-DE',
        targetLanguageCode: 'de',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('returns transcript without translation call when source and target match', async () => {
    const seeded = await service.updateSettings({
      googleProjectId: 'my-project',
      googleServiceAccountJson: JSON.stringify({
        client_email: 'service@project.iam.gserviceaccount.com',
        private_key: 'secret',
        project_id: 'my-project',
      }),
    });
    (
      mockPrisma.voiceTranslationSettings.findFirst as jest.Mock
    ).mockResolvedValue({
      google_project_id: seeded.googleProjectId,
      google_location: seeded.googleLocation,
      google_service_account_encrypted: (
        mockPrisma.voiceTranslationSettings.upsert as jest.Mock
      ).mock.calls[0][0].update.google_service_account_encrypted,
    });
    mockLongRunningRecognize.mockResolvedValue([
      {
        promise: async () => [
          {
            results: [
              {
                alternatives: [{ transcript: 'Bereits Deutsch' }],
                languageCode: 'de-DE',
              },
            ],
          },
        ],
      },
    ]);

    const result = await service.translateVoiceNote({
      audioBuffer: Buffer.from('audio'),
      filename: 'note.webm',
      mimeType: 'audio/webm',
      sourceLanguageCode: 'de-DE',
      targetLanguageCode: 'de',
    });

    expect(result.originalText).toBe('Bereits Deutsch');
    expect(result.translatedText).toBe('Bereits Deutsch');
    expect(mockTranslateText).not.toHaveBeenCalled();
  });
});
