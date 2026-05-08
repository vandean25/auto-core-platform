import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_PLATFORM_ADMIN_KEY } from '../common/decorators/allow-platform-admin.decorator';
import { MECHANIC_ACCESSIBLE_KEY } from '../common/decorators/mechanic-accessible.decorator';
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

    // ADR-0014 §8.2: A mechanic-mode session (role === TECH) may only access
    // endpoints explicitly marked with @MechanicAccessible(). All other
    // back-office endpoints must reject the request even if the underlying
    // tenant member still maps to TenantMemberRole.TECH.
    if ('role' in request.user && request.user.role === 'TECH') {
      const isMechanicAccessible =
        this.reflector.getAllAndOverride<boolean>(MECHANIC_ACCESSIBLE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? false;

      if (!isMechanicAccessible) {
        throw new ForbiddenException(
          'Mechanic-mode sessions may only access endpoints marked @MechanicAccessible().',
        );
      }
    }

    return true;
  }
}
