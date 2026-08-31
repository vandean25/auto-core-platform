import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantContextService } from '../common/services/tenant-context.service';
import { CatalogProviderSettingsService } from './catalog-provider-settings.service';
import {
  CatalogProviderSettingsResponseDto,
  UpdateCatalogProviderSettingsDto,
} from './dto/catalog-provider-settings.dto';

@ApiTags('settings')
@Controller('settings/catalog-providers')
export class CatalogProviderSettingsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly catalogProviderSettingsService: CatalogProviderSettingsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: CatalogProviderSettingsResponseDto })
  getSettings(): Promise<CatalogProviderSettingsResponseDto> {
    this.assertTenantAdminAccess();
    return this.catalogProviderSettingsService.getSettings();
  }

  @Patch()
  @ApiOkResponse({ type: CatalogProviderSettingsResponseDto })
  updateSettings(
    @Body() dto: UpdateCatalogProviderSettingsDto,
  ): Promise<CatalogProviderSettingsResponseDto> {
    this.assertTenantAdminAccess();
    return this.catalogProviderSettingsService.updateSettings(dto);
  }

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }
}
