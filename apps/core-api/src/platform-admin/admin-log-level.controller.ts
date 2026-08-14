import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AllowPlatformAdmin } from '../common/decorators/allow-platform-admin.decorator';
import { LogLevelService } from '../common/logging/log-level.service';
import {
  LogLevelResponseDto,
  UpdateLogLevelDto,
} from './dto/log-level.dto';

@ApiTags('admin-settings')
@ApiBearerAuth()
@AllowPlatformAdmin()
@UseGuards(SuperAdminGuard)
@Controller('admin/settings/log-level')
export class AdminLogLevelController {
  constructor(private readonly logLevelService: LogLevelService) {}

  @Get()
  @ApiOperation({
    summary: 'Get operational log level settings and active override',
  })
  @ApiOkResponse({ type: LogLevelResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Requires SUPER_ADMIN platform role' })
  getLogLevel(): LogLevelResponseDto {
    return this.logLevelService.getStatus();
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Update runtime operational log level with optional expiration duration',
  })
  @ApiOkResponse({ type: LogLevelResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Requires SUPER_ADMIN platform role' })
  updateLogLevel(
    @Body() dto: UpdateLogLevelDto,
    @Req() req: Request & { user?: AuthenticatedUser },
  ): LogLevelResponseDto {
    this.logLevelService.setLogLevel({
      level: dto.level,
      durationMinutes: dto.durationMinutes,
      actorId: req.user?.userId,
    });

    return this.logLevelService.getStatus();
  }
}
