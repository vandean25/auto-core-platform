import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateTenantApiKeyDto,
  TenantApiKeyCreatedResponseDto,
  TenantApiKeyListResponseDto,
  TenantApiKeyResponseDto,
} from './dto/tenant-api-key.dto.js';
import { TenantApiKeyService } from './tenant-api-key.service.js';

/**
 * Key management for OWNER and ADMIN sessions. These routes are not mapped to a public scope, so an API
 * key can never call them (deny by default, ADR-0026).
 */
@ApiTags('tenant-api-keys')
@Controller('tenant-api-keys')
export class TenantApiKeyController {
  constructor(private readonly tenantApiKeys: TenantApiKeyService) {}

  @Get()
  @ApiOkResponse({ type: TenantApiKeyListResponseDto })
  list(): Promise<TenantApiKeyListResponseDto> {
    return this.tenantApiKeys.list();
  }

  @Post()
  @ApiCreatedResponse({ type: TenantApiKeyCreatedResponseDto })
  create(
    @Body() dto: CreateTenantApiKeyDto,
  ): Promise<TenantApiKeyCreatedResponseDto> {
    return this.tenantApiKeys.create(dto);
  }

  @Post(':id/revoke')
  @ApiOkResponse({ type: TenantApiKeyResponseDto })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TenantApiKeyResponseDto> {
    return this.tenantApiKeys.revoke(id);
  }
}
