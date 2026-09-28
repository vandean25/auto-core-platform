import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  UpdateWorkshopSettingsDto,
  WorkshopSettingsResponseDto,
} from './dto/workshop-settings.dto.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';

@ApiTags('Workshop')
@Controller('workshop/settings')
export class WorkshopSettingsController {
  constructor(private readonly settingsService: WorkshopSettingsService) {}

  @Get()
  @ApiOperation({ operationId: 'WorkshopController_getSettings' })
  @ApiOkResponse({ type: WorkshopSettingsResponseDto })
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put()
  @ApiOperation({ operationId: 'WorkshopController_updateSettings' })
  @ApiOkResponse({ type: WorkshopSettingsResponseDto })
  updateSettings(@Body() dto: UpdateWorkshopSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
