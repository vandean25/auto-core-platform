import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  isApiKeyPrincipal,
  type AuthenticatedUser,
} from '../auth/types/authenticated-user.js';
import { OPERATION_TABLE } from './operation-table.js';
import {
  PermissionResolver,
  isMemberAllowed,
  type EffectiveAccess,
} from './permission-resolver.js';

type MemberRequest = Request & { user?: AuthenticatedUser };

/**
 * Authorizes a tenant member from the 1a operation table. Not registered anywhere yet (AUT-865/866 switch consumers).
 * A granted permission is necessary only: tenant, site, employee and business-state checks stay in the services.
 * Routes with their own guard (public, service job, platform admin, API key) are left to that guard.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly resolver: PermissionResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation =
      OPERATION_TABLE[
        `${context.getClass().name}.${context.getHandler().name}`
      ];
    if (!operation) {
      throw new ForbiddenException('This operation is not classified.');
    }
    if (operation.kind !== 'protected' && operation.kind !== 'session') {
      return true;
    }
    const request = context.switchToHttp().getRequest<MemberRequest>();
    const access = await this.resolveMember(request);
    const path = request.path ?? request.url?.split('?')[0] ?? '';
    if (!isMemberAllowed(operation, access, { method: request.method, path })) {
      throw new ForbiddenException('Missing permission for this operation.');
    }
    return true;
  }

  private async resolveMember(
    request: MemberRequest,
  ): Promise<EffectiveAccess> {
    const user = request.user;
    // Tenant API keys (ADR-0026) are never tenant members, whatever permission identifiers they share.
    if (!user?.tenantId || isApiKeyPrincipal(user)) {
      throw new ForbiddenException('A tenant member session is required.');
    }
    const access = await this.resolver.resolve(request, {
      userId: user.userId,
      tenantId: user.tenantId,
    });
    if (!access) {
      throw new ForbiddenException('Active tenant membership is required.');
    }
    return access;
  }
}
