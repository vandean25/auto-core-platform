import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  UpdateVoiceTranslationSettingsDto,
  VoiceTranslationSettingsResponseDto,
} from './dto/voice-translation-settings.dto';
import { VoiceTranslationService } from './voice-translation.service';

@ApiTags('voice-translation')
@Controller('voice-translation')
export class VoiceTranslationController {
  constructor(
    private readonly voiceTranslationService: VoiceTranslationService,
  ) {}

  @Get('settings')
  @ApiOkResponse({ type: VoiceTranslationSettingsResponseDto })
  getSettings(): Promise<VoiceTranslationSettingsResponseDto> {
    return this.voiceTranslationService.getSettings();
  }

  @Patch('settings')
  @ApiOkResponse({ type: VoiceTranslationSettingsResponseDto })
  updateSettings(
    @Body() dto: UpdateVoiceTranslationSettingsDto,
  ): Promise<VoiceTranslationSettingsResponseDto> {
    return this.voiceTranslationService.updateSettings(dto);
  }
}

