import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator';
import { AuthSessionService, type AuthSession } from './auth-session.service';
import {
  AuthSessionResponseDto,
  SwitchTenantDto,
} from './dto/auth-session.dto';
import type { AuthenticatedUser } from './types/authenticated-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly authSessionService: AuthSessionService) {}

  @Get('me')
  @MechanicAccessible()
  @ApiOkResponse({ type: AuthSessionResponseDto })
  getMe(
    @Req() request: Request & { user: AuthenticatedUser },
  ): Promise<AuthSession> {
    return this.authSessionService.getSessionForAuthenticatedUser(request.user);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  switchTenant(
    @Req() request: Request & { user: AuthenticatedUser },
    @Body() dto: SwitchTenantDto,
  ): Promise<AuthSession> {
    return this.authSessionService.switchTenant(request.user, dto.tenantId);
  }
}
