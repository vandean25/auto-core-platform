import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import { ScopeContextResponseHeadersInterceptor } from './scope-context/scope-context-response-headers.interceptor.js';
import {
  AuthSessionService,
  type AuthSession,
} from './auth-session.service.js';
import {
  AuthSessionResponseDto,
  SwitchTenantDto,
} from './dto/auth-session.dto.js';
import type { AuthenticatedUser } from './types/authenticated-user.js';
import {
  AUTH_ME_RATE_LIMIT,
  AUTH_SWITCH_TENANT_RATE_LIMIT,
} from './auth-throttling.js';
import { ScopeContextHandshakeResponseDto } from './scope-context/dto/scope-context-response.dto.js';
import { ScopeContextLogoutService } from './scope-context/scope-context-logout.service.js';
import { ScopeContextService } from './scope-context/scope-context.service.js';
import type { TenantAuthenticatedUser } from './types/authenticated-user.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly scopeContextService: ScopeContextService,
    private readonly scopeContextLogoutService: ScopeContextLogoutService,
  ) {}

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

  @Post('scope-context')
  @MechanicAccessible()
  @UseInterceptors(ScopeContextResponseHeadersInterceptor)
  @HttpCode(200)
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiOkResponse({ type: ScopeContextHandshakeResponseDto })
  async scopeContext(
    @Req() request: Request & { user: AuthenticatedUser },
  ): Promise<ScopeContextHandshakeResponseDto> {
    if (!request.user.tenantId) {
      throw new UnauthorizedException('Tenant session required.');
    }
    const token = extractBearerToken(request.headers.authorization);
    return this.scopeContextService.handshake(
      request.user as TenantAuthenticatedUser,
      token,
    );
  }

  @Post('logout')
  @MechanicAccessible()
  @UseInterceptors(ScopeContextResponseHeadersInterceptor)
  @HttpCode(204)
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiNoContentResponse({ description: 'Session lineage ended.' })
  async logout(
    @Req() request: Request & { user: AuthenticatedUser },
  ): Promise<void> {
    if (!request.user.tenantId) {
      throw new UnauthorizedException('Tenant session required.');
    }
    const token = extractBearerToken(request.headers.authorization);
    await this.scopeContextLogoutService.logout(
      request.user as TenantAuthenticatedUser,
      token,
    );
  }
}

function extractBearerToken(authorizationHeader?: string): string {
  if (!authorizationHeader) {
    throw new UnauthorizedException('Missing Authorization header.');
  }
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedException('Invalid Authorization header.');
  }
  return token;
}
