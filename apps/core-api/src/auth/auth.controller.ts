import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator';
import { AuthSessionService, type AuthSession } from './auth-session.service';
import {
  AuthSessionResponseDto,
  SwitchTenantDto,
} from './dto/auth-session.dto';
import type { AuthenticatedUser } from './types/authenticated-user';
import {
  AUTH_ME_RATE_LIMIT,
  AUTH_SWITCH_TENANT_RATE_LIMIT,
} from './auth-throttling';

@Controller('auth')
export class AuthController {
  constructor(private readonly authSessionService: AuthSessionService) {}

  @Get('me')
  @Throttle({ default: AUTH_ME_RATE_LIMIT })
  @MechanicAccessible()
  @ApiOkResponse({ type: AuthSessionResponseDto })
  getMe(
    @Req() request: Request & { user: AuthenticatedUser },
  ): Promise<AuthSession> {
    return this.authSessionService.getSessionForAuthenticatedUser(request.user);
  }

  @Post('switch-tenant')
  @Throttle({ default: AUTH_SWITCH_TENANT_RATE_LIMIT })
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  switchTenant(
    @Req() request: Request & { user: AuthenticatedUser },
    @Body() dto: SwitchTenantDto,
  ): Promise<AuthSession> {
    return this.authSessionService.switchTenant(request.user, dto.tenantId);
  }
}
