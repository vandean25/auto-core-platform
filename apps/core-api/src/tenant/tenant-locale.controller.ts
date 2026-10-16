import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  PatchTenantLocaleSettingsDto,
  TenantLocaleSettingsResponseDto,
} from '../auth/dto/user-locale-preferences.dto.js';
import { TenantLocaleService } from './tenant-locale.service.js';

@ApiTags('tenants')
@Controller('tenants/current/locale')
export class TenantLocaleController {
  constructor(private readonly tenantLocale: TenantLocaleService) {}

  @Get()
  @ApiOkResponse({ type: TenantLocaleSettingsResponseDto })
  getCurrent(): Promise<TenantLocaleSettingsResponseDto> {
    return this.tenantLocale.getCurrent();
  }

  @Patch()
  @ApiOkResponse({ type: TenantLocaleSettingsResponseDto })
  patchCurrent(
    @Body() body: PatchTenantLocaleSettingsDto,
  ): Promise<TenantLocaleSettingsResponseDto> {
    return this.tenantLocale.patchCurrent(body.default_locale);
  }
}
