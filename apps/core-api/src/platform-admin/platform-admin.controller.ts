import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../auth/super-admin.guard.js';
import { AllowPlatformAdmin } from '../common/decorators/allow-platform-admin.decorator.js';
import {
  CreatePlatformTenantDto,
  ListPlatformTenantsQueryDto,
  PlatformTenantListResponseDto,
  PlatformTenantResponseDto,
  UpdatePlatformTenantDto,
} from './dto/platform-tenant.dto.js';
import { PlatformAdminService } from './platform-admin.service.js';

@ApiTags('platform-tenants')
@AllowPlatformAdmin()
@UseGuards(SuperAdminGuard)
@Controller('platform/tenants')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantListResponseDto })
  findAll(@Query() query: ListPlatformTenantsQueryDto) {
    return this.platformAdminService.findAll(query);
  }

  @Post()
  @ApiCreatedResponse({ type: PlatformTenantResponseDto })
  create(@Body() dto: CreatePlatformTenantDto) {
    return this.platformAdminService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdatePlatformTenantDto) {
    return this.platformAdminService.update(id, dto);
  }
}
