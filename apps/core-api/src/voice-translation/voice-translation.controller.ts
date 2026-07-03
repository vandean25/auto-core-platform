import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  UpdateVoiceTranslationSettingsDto,
  VoiceTranslationSettingsResponseDto,
} from './dto/voice-translation-settings.dto';
import { TenantContextService } from '../common/services/tenant-context.service';
import { VoiceTranslationService } from './voice-translation.service';

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

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }
}
