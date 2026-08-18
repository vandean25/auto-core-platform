import {
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopTaskStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceTranslationService } from '../voice-translation/voice-translation.service';
import {
  ALLOWED_VOICE_NOTE_MIME_TYPES,
  MAX_VOICE_NOTE_BYTES,
  MAX_VOICE_NOTE_DURATION_SECONDS,
  MIN_VOICE_NOTE_BYTES,
  type VoiceNoteDraftResponseDto,
} from './dto/voice-note.dto';
import { readAudioDurationSeconds } from './audio-duration';
import { assertTaskAssignedToMechanic } from './mechanic-task-access';
import { RateLimitStore } from './rate-limit/rate-limit.store';

/**
 * Rate-limit configuration for the voice-note upload endpoint.
 * Configurable via environment variables (ADR-0014 §5.3 guardrails).
 *
 * VOICE_NOTE_RATE_LIMIT_MAX            — max uploads per mechanic per window (default 10)
 * VOICE_NOTE_RATE_LIMIT_TTL_SECONDS    — sliding-window length in seconds (default 60)
 */
function getVoiceNoteRateLimitConfig(): { max: number; ttlMs: number } {
  const max = parseInt(process.env.VOICE_NOTE_RATE_LIMIT_MAX ?? '10', 10);
  const ttlSeconds = parseInt(
    process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS ?? '60',
    10,
  );
  return {
    max: Number.isFinite(max) && max > 0 ? max : 10,
    ttlMs:
      Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? ttlSeconds * 1000
        : 60_000,
  };
}

const VOICE_NOTE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

function getVoiceNoteFilename(
  file: Express.Multer.File,
  mimeType: string,
): string {
  const originalName = file.originalname?.trim();
  if (
    originalName &&
    originalName !== 'blob' &&
    /\.[a-z0-9]+$/i.test(originalName)
  ) {
    return originalName;
  }

  const extension = VOICE_NOTE_EXTENSION_BY_MIME_TYPE[mimeType] ?? 'bin';
  return `voice-note.${extension}`;
}

@Injectable()
export class MechanicVoiceNoteService {
  private readonly logger = new Logger(MechanicVoiceNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly voiceTranslationService: VoiceTranslationService,
    @Inject(RateLimitStore) private readonly rateLimitStore: RateLimitStore,
  ) {}

  async uploadVoiceNote(
    mechanicId: string,
    taskId: string,
    file: Express.Multer.File,
  ): Promise<VoiceNoteDraftResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();

    // ── Rate limiting (per mechanic, sliding window) ────────────────────────
    await this.checkVoiceNoteRateLimit(mechanicId, tenantId);

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        status: true,
        mechanic_id: true,
        workshop_order_id: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new ForbiddenException(
        'Cannot upload voice notes for a completed task.',
      );
    }

    assertTaskAssignedToMechanic(task, mechanicId);

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new UnprocessableEntityException(
        'Audio file must not be empty. Include an audio file in the "audio" field.',
      );
    }

    if (file.buffer.length < MIN_VOICE_NOTE_BYTES) {
      throw new UnprocessableEntityException(
        `Audio file is too small (${file.buffer.length} bytes). The recording appears to be empty or silent.`,
      );
    }

    if (file.buffer.length > MAX_VOICE_NOTE_BYTES) {
      throw new UnprocessableEntityException(
        `Audio file size ${file.buffer.length} bytes exceeds the maximum of ${MAX_VOICE_NOTE_BYTES} bytes (25 MiB).`,
      );
    }

    const normalizedMime = (file.mimetype ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!ALLOWED_VOICE_NOTE_MIME_TYPES.has(normalizedMime)) {
      throw new UnprocessableEntityException(
        `Unsupported audio format "${file.mimetype}". Allowed formats: ${[...ALLOWED_VOICE_NOTE_MIME_TYPES].join(', ')}.`,
      );
    }

    // Log safe operational metadata only — never log audio content or transcript text.
    // ADR-0014 §5.3 — Observability without content logging.
    const sizeBytes = file.buffer.length;
    this.logger.log(
      `voice_note_start tenantId=${tenantId} taskId=${taskId} bytes=${sizeBytes} mimeType=${normalizedMime}`,
    );

    const parsedDurationSeconds = readAudioDurationSeconds(
      file.buffer,
      normalizedMime,
    );
    if (
      parsedDurationSeconds !== undefined &&
      parsedDurationSeconds > MAX_VOICE_NOTE_DURATION_SECONDS
    ) {
      file.buffer.fill(0);
      throw new UnprocessableEntityException(
        `Audio recording duration ${parsedDurationSeconds.toFixed(1)}s exceeds the maximum of ${MAX_VOICE_NOTE_DURATION_SECONDS}s.`,
      );
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: mechanicId,
        tenant_id: tenantId,
        role: 'MECHANIC',
      },
      select: { mother_language_code: true },
    });
    const targetLanguageCode =
      await this.voiceTranslationService.getTargetLanguageCode(tenantId);
    const sourceLanguageCode =
      employee?.mother_language_code || targetLanguageCode;

    const startedAt = Date.now();
    let result: {
      originalText: string;
      translatedText: string;
      sourceLanguageCode: string;
      targetLanguageCode: string;
      detectedLanguageCode?: string;
      provider: string;
      model: string;
      durationSeconds?: number;
    };
    try {
      result = await this.voiceTranslationService.translateVoiceNote({
        audioBuffer: file.buffer,
        filename: getVoiceNoteFilename(file, normalizedMime),
        mimeType: normalizedMime,
        sourceLanguageCode,
        targetLanguageCode,
      });
    } catch (error) {
      // Zero out the audio buffer immediately to release sensitive data.
      // ADR-0014 §5.3 — Audio retention minimisation.
      file.buffer.fill(0);

      const latencyMs = Date.now() - startedAt;
      const failureClass = error instanceof Error ? error.name : 'UnknownError';

      // Log only safe metadata — no transcript text, no audio content.
      this.logger.warn(
        `voice_note_failure tenantId=${tenantId} taskId=${taskId} latencyMs=${latencyMs} failureClass=${failureClass}`,
      );

      if (error instanceof BadRequestException) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadGatewayException(
        'Voice-note transcription failed due to an upstream provider error. Please try again.',
      );
    }

    // Zero out the audio buffer immediately after successful transcription.
    // ADR-0014 §5.3 — Audio retention minimisation.
    file.buffer.fill(0);
    const originalText = result.originalText ?? result.translatedText ?? '';
    const translatedText = result.translatedText ?? result.originalText ?? '';

    if (
      result.durationSeconds !== undefined &&
      result.durationSeconds !== null &&
      result.durationSeconds > MAX_VOICE_NOTE_DURATION_SECONDS
    ) {
      throw new UnprocessableEntityException(
        `Audio recording duration ${result.durationSeconds.toFixed(1)}s exceeds the maximum of ${MAX_VOICE_NOTE_DURATION_SECONDS}s.`,
      );
    }

    if (!originalText || originalText.trim().length === 0) {
      throw new UnprocessableEntityException(
        'Voice note appears to be silent - no speech was detected in the recording.',
      );
    }

    const savedDraft = await this.prisma.workshopVoiceNoteDraft.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        mechanic_employee_id: mechanicId,
        status: 'PENDING',
        source_language_code: result.sourceLanguageCode,
        target_language_code: result.targetLanguageCode,
        original_text: originalText,
        translated_text: translatedText,
        provider: result.provider,
        model: result.model,
        duration_seconds:
          result.durationSeconds != null
            ? new Prisma.Decimal(result.durationSeconds)
            : null,
      },
      select: { id: true },
    });

    const latencyMs = Date.now() - startedAt;
    // Log only safe operational metadata — never log draft.text (transcript content).
    // ADR-0014 §5.3 — Observability without content logging.
    this.logger.log(
      `voice_note_success tenantId=${tenantId} taskId=${taskId} provider=${result.provider} model=${result.model} latencyMs=${latencyMs} durationSeconds=${result.durationSeconds ?? 'unknown'}`,
    );

    return {
      draftId: savedDraft.id,
      text: translatedText,
      originalText: originalText,
      sourceLanguageCode: result.sourceLanguageCode,
      targetLanguageCode: result.targetLanguageCode,
      detectedLanguage: result.detectedLanguageCode,
      provider: result.provider,
      model: result.model,
      durationSeconds: result.durationSeconds,
    } satisfies VoiceNoteDraftResponseDto;
  }

  /**
   * Enforces a per-mechanic sliding-window rate limit for voice-note uploads.
   *
   * Limit and window are read from environment variables at runtime so that
   * operators can tune them without a code deploy. The injected store is shared
   * across Cloud Run instances.
   *
   * Throws HTTP 429 when the mechanic has exceeded the allowed number of
   * uploads within the current window.
   *
   * ADR-0014 §5.3 — rate and abuse controls.
   */
  private async checkVoiceNoteRateLimit(
    mechanicId: string,
    tenantId: string,
  ): Promise<void> {
    const window = getVoiceNoteRateLimitConfig();
    const decision = await this.rateLimitStore.consume(
      { tenantId, mechanicId },
      window,
    );

    if (!decision.allowed) {
      const windowSeconds = Math.ceil(window.ttlMs / 1000);
      throw new HttpException(
        `Voice note rate limit exceeded. Maximum ${window.max} uploads per ${windowSeconds}s window. Retry after ${decision.retryAfterSeconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
