import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_PLATFORM_ADMIN_KEY } from '../common/decorators/allow-platform-admin.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { TenantContextService } from '../common/services/tenant-context.service';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './types/authenticated-user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const allowPlatformAdmin =
      this.reflector.getAllAndOverride<boolean>(ALLOW_PLATFORM_ADMIN_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    request.user = allowPlatformAdmin
      ? await this.authService.authenticateBearerToken(
          request.headers.authorization,
          { allowPlatformAdmin: true },
        )
      : await this.authService.authenticateBearerToken(
          request.headers.authorization,
        );

    if (request.user.tenantId) {
      this.tenantContext.setAuthenticatedUser(request.user);
    }

    return true;
  }
}
