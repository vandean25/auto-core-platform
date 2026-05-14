import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TranslationServiceClient } from '@google-cloud/translate';
import { SpeechClient } from '@google-cloud/speech';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  UpdateVoiceTranslationSettingsDto,
  VoiceTranslationSettingsResponseDto,
} from './dto/voice-translation-settings.dto';
import type {
  VoiceTranslationRequest,
  VoiceTranslationResult,
} from './voice-translation.types';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const DEFAULT_TARGET_LANGUAGE = 'de';
const DEFAULT_LOCATION = 'global';
const PROVIDER_NAME = 'google-cloud';
const MODEL_NAME = 'latest_long';
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

function normalizeLanguageCode(value: string): string {
  const trimmed = value.trim();
  if (!LANGUAGE_CODE_PATTERN.test(trimmed)) {
    throw new BadRequestException(
      `Language code "${value}" is invalid. Use a BCP-47 code like "de", "de-DE", or "pl-PL".`,
    );
  }
  return trimmed;
}

function normalizeTargetTranslationLanguage(value: string): string {
  const normalized = normalizeLanguageCode(value).toLowerCase();
  const [base] = normalized.split('-');
  return base;
}

function toRecognitionEncoding(mimeType: string):
  | 'WEBM_OPUS'
  | 'MP3'
  | 'OGG_OPUS'
  | 'LINEAR16'
  | 'FLAC'
  | undefined {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('webm')) return 'WEBM_OPUS';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'MP3';
  if (normalized.includes('ogg')) return 'OGG_OPUS';
  if (normalized.includes('wav')) return 'LINEAR16';
  if (normalized.includes('flac')) return 'FLAC';
  return undefined;
}

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type GoogleClientBundle = {
  speech: SpeechClient;
  translation: TranslationServiceClient;
};

@Injectable()
export class VoiceTranslationService {
  private readonly clientCache = new Map<string, GoogleClientBundle>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getSettings(): Promise<VoiceTranslationSettingsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const row = await this.prisma.voiceTranslationSettings.findFirst({
      where: { tenant_id: tenantId },
    });

    if (!row) {
      return {
        id: '00000000-0000-0000-0000-000000000000',
        targetLanguageCode: DEFAULT_TARGET_LANGUAGE,
        googleProjectId: null,
        googleLocation: DEFAULT_LOCATION,
        hasGoogleCredential: false,
        updatedAt: new Date(0),
      };
    }

    return this.mapSettings(row);
  }

  async updateSettings(
    dto: UpdateVoiceTranslationSettingsDto,
  ): Promise<VoiceTranslationSettingsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const encryptedCredential =
      dto.googleServiceAccountJson === undefined
        ? undefined
        : dto.googleServiceAccountJson === null
          ? null
          : this.encryptCredential(
              JSON.stringify(this.parseServiceAccount(dto.googleServiceAccountJson)),
            );

    const updated = await this.prisma.voiceTranslationSettings.upsert({
      where: { tenant_id: tenantId },
      update: {
        ...(dto.targetLanguageCode !== undefined
          ? {
              target_language_code: normalizeTargetTranslationLanguage(
                dto.targetLanguageCode,
              ),
            }
          : {}),
        ...(dto.googleProjectId !== undefined
          ? { google_project_id: dto.googleProjectId?.trim() || null }
          : {}),
        ...(dto.googleLocation !== undefined
          ? { google_location: dto.googleLocation.trim() || DEFAULT_LOCATION }
          : {}),
        ...(encryptedCredential !== undefined
          ? { google_service_account_encrypted: encryptedCredential }
          : {}),
      },
      create: {
        tenant_id: tenantId,
        target_language_code:
          dto.targetLanguageCode !== undefined
            ? normalizeTargetTranslationLanguage(dto.targetLanguageCode)
            : DEFAULT_TARGET_LANGUAGE,
        google_project_id: dto.googleProjectId?.trim() || null,
        google_location: dto.googleLocation?.trim() || DEFAULT_LOCATION,
        google_service_account_encrypted: encryptedCredential ?? null,
      },
    });

    return this.mapSettings(updated);
  }

  async getTargetLanguageCode(tenantId: string): Promise<string> {
    const settings = await this.prisma.voiceTranslationSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { target_language_code: true },
    });
    return settings?.target_language_code ?? DEFAULT_TARGET_LANGUAGE;
  }

  async translateVoiceNote(
    request: VoiceTranslationRequest,
  ): Promise<VoiceTranslationResult> {
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.prisma.voiceTranslationSettings.findFirst({
      where: { tenant_id: tenantId },
      select: {
        google_project_id: true,
        google_location: true,
        google_service_account_encrypted: true,
      },
    });

    if (!settings?.google_service_account_encrypted) {
      throw new ServiceUnavailableException(
        'Google voice translation credential is not configured.',
      );
    }

    const credentials = this.decryptCredential(
      settings.google_service_account_encrypted,
    );
    const parsed = this.parseServiceAccount(credentials);
    const projectId = settings.google_project_id ?? parsed.project_id;
    if (!projectId) {
      throw new ServiceUnavailableException(
        'Google project id is required for voice translation.',
      );
    }

    const location = settings.google_location || DEFAULT_LOCATION;
    const { speech, translation } = this.getOrCreateClients(parsed, projectId);
    const sourceLanguage = normalizeLanguageCode(request.sourceLanguageCode);
    const targetLanguage = normalizeTargetTranslationLanguage(
      request.targetLanguageCode,
    );
    const requestEncoding = toRecognitionEncoding(request.mimeType);
    const [recognizeOperation] = await speech.longRunningRecognize({
      config: {
        ...(requestEncoding ? { encoding: requestEncoding } : {}),
        languageCode: sourceLanguage,
        model: MODEL_NAME,
      },
      audio: {
        content: request.audioBuffer.toString('base64'),
      },
    });
    const [recognizeResponse] = (await recognizeOperation.promise()) as unknown as [
      { results?: Array<{ alternatives?: Array<{ transcript?: string }>; languageCode?: string }> },
    ];

    const originalText =
      recognizeResponse.results
        ?.flatMap((r) => r.alternatives ?? [])
        .map((a) => a.transcript ?? '')
        .join(' ')
        .trim() ?? '';

    const detectedLanguageCode =
      recognizeResponse.results?.[0]?.languageCode ?? undefined;

    if (!originalText) {
      return {
        originalText: '',
        translatedText: '',
        sourceLanguageCode: sourceLanguage,
        targetLanguageCode: targetLanguage,
        detectedLanguageCode,
        provider: PROVIDER_NAME,
        model: MODEL_NAME,
      };
    }

    const normalizedDetectedLanguage = detectedLanguageCode
      ? normalizeTargetTranslationLanguage(detectedLanguageCode)
      : undefined;
    const normalizedSourceLanguage =
      normalizedDetectedLanguage ??
      normalizeTargetTranslationLanguage(sourceLanguage);

    if (normalizedSourceLanguage === targetLanguage) {
      return {
        originalText,
        translatedText: originalText,
        sourceLanguageCode: sourceLanguage,
        targetLanguageCode: targetLanguage,
        detectedLanguageCode,
        provider: PROVIDER_NAME,
        model: MODEL_NAME,
      };
    }

    const [translationResponse] = await translation.translateText({
      parent: `projects/${projectId}/locations/${location}`,
      targetLanguageCode: targetLanguage,
      contents: [originalText],
      mimeType: 'text/plain',
    });

    const translatedText =
      translationResponse.translations?.[0]?.translatedText?.trim() ??
      originalText;

    return {
      originalText,
      translatedText,
      sourceLanguageCode: sourceLanguage,
      targetLanguageCode: targetLanguage,
      detectedLanguageCode,
      provider: PROVIDER_NAME,
      model: MODEL_NAME,
    };
  }

  private mapSettings(row: {
    id: string;
    target_language_code: string;
    google_project_id: string | null;
    google_location: string;
    google_service_account_encrypted: string | null;
    updatedAt: Date;
  }): VoiceTranslationSettingsResponseDto {
    return {
      id: row.id,
      targetLanguageCode: row.target_language_code,
      googleProjectId: row.google_project_id,
      googleLocation: row.google_location,
      hasGoogleCredential: Boolean(row.google_service_account_encrypted),
      updatedAt: row.updatedAt,
    };
  }

  private getEncryptionKey(): Buffer {
    const raw = process.env.SECRET_ENCRYPTION_KEY;
    if (!raw) {
      throw new InternalServerErrorException(
        'SECRET_ENCRYPTION_KEY is required to store Google credentials.',
      );
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
      );
    }
    return key;
  }

  private encryptCredential(value: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decryptCredential(value: string): string {
    const key = this.getEncryptionKey();
    const [version, ivB64, tagB64, encryptedB64] = value.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !encryptedB64) {
      throw new ServiceUnavailableException(
        'Stored Google credential format is invalid.',
      );
    }
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const clear = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return clear.toString('utf8');
  }

  private parseServiceAccount(raw: string): GoogleServiceAccount {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Google service account JSON is invalid.');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>).client_email !== 'string' ||
      typeof (parsed as Record<string, unknown>).private_key !== 'string'
    ) {
      throw new BadRequestException(
        'Google service account JSON must include client_email and private_key.',
      );
    }

    return parsed as GoogleServiceAccount;
  }

  private getOrCreateClients(
    credentials: GoogleServiceAccount,
    projectId: string,
  ): GoogleClientBundle {
    const cacheKey = createHash('sha256')
      .update(JSON.stringify({ credentials, projectId }))
      .digest('hex');
    const existing = this.clientCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const created = {
      speech: new SpeechClient({ credentials, projectId }),
      translation: new TranslationServiceClient({ credentials, projectId }),
    };
    this.clientCache.set(cacheKey, created);
    return created;
  }
}
