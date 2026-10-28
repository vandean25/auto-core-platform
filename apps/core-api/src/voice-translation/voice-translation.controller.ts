import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadGatewayResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  UpdateVoiceTranslationSettingsDto,
  VoiceTranslationSettingsResponseDto,
} from './dto/voice-translation-settings.dto.js';
import {
  ALLOWED_TRANSCRIPT_MIME_TYPES,
  MAX_TRANSCRIPT_BYTES,
  MIN_TRANSCRIPT_BYTES,
  VoiceTranscriptResponseDto,
} from './dto/voice-transcript.dto.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { VoiceTranslationService } from './voice-translation.service.js';

const TRANSCRIPT_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

@ApiTags('voice-translation')
@Controller('voice-translation')
export class VoiceTranslationController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly voiceTranslationService: VoiceTranslationService,
  ) {}

  @Get('settings')
  @ApiOkResponse({ type: VoiceTranslationSettingsResponseDto })
  getSettings(): Promise<VoiceTranslationSettingsResponseDto> {
    this.assertTenantAdminAccess();
    return this.voiceTranslationService.getSettings();
  }

  @Patch('settings')
  @ApiOkResponse({ type: VoiceTranslationSettingsResponseDto })
  updateSettings(
    @Body() dto: UpdateVoiceTranslationSettingsDto,
  ): Promise<VoiceTranslationSettingsResponseDto> {
    this.assertTenantAdminAccess();
    return this.voiceTranslationService.updateSettings(dto);
  }

  @Post('transcribe')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_TRANSCRIPT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description:
            'Speech recording. Max 25 MiB. Transcript only, no translation.',
        },
      },
    },
  })
  @ApiOkResponse({ type: VoiceTranscriptResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      'Unsupported audio type, empty recording, or no speech detected.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Speech provider is not configured.',
  })
  @ApiBadGatewayResponse({ description: 'Speech provider failed.' })
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<VoiceTranscriptResponseDto> {
    this.assertTranscriptAccess();
    this.assertAudio(file);
    const mimeType = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    const result = await this.voiceTranslationService.transcribeVoiceNote({
      audioBuffer: file.buffer,
      filename: file.originalname ?? 'voice-command',
      mimeType,
      sourceLanguageCode: 'de-AT',
    });
    if (!result.transcript) {
      throw new UnprocessableEntityException({
        code: 'TRANSCRIPT_EMPTY',
        message: 'The recording did not contain recognizable speech.',
      });
    }
    return result;
  }

  private assertTranscriptAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || !user.role || !TRANSCRIPT_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Voice commands are available to OWNER, ADMIN, and SALES roles only.',
      );
    }
  }

  private assertAudio(file: Express.Multer.File | undefined): void {
    if (!file?.buffer || file.buffer.length < MIN_TRANSCRIPT_BYTES) {
      throw new UnprocessableEntityException({
        code: 'AUDIO_EMPTY',
        message: 'The recording is empty.',
      });
    }
    if (file.buffer.length > MAX_TRANSCRIPT_BYTES) {
      throw new UnprocessableEntityException({
        code: 'AUDIO_TOO_LARGE',
        message: 'The recording exceeds 25 MiB.',
      });
    }
    const mimeType = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TRANSCRIPT_MIME_TYPES.has(mimeType)) {
      throw new UnprocessableEntityException({
        code: 'AUDIO_UNSUPPORTED_TYPE',
        message: `Unsupported audio type: ${mimeType || 'unknown'}.`,
      });
    }
  }

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }
}
