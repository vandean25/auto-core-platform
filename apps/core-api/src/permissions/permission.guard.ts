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
  isOperationAllowed,
} from './permission-resolver.js';

/**
 * Authorizes a tenant member from the 1a operation table. Not registered anywhere yet (AUT-865/866 switch consumers).
 * A granted permission is necessary only: tenant, site, employee and business-state checks stay in the services.
 * Routes with their own guard (public, service job, platform admin, API key) are left to that guard.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly resolver: PermissionResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const id = `${context.getClass().name}.${context.getHandler().name}`;
    const operation = OPERATION_TABLE[id];
    if (!operation) {
      throw new ForbiddenException('This operation is not classified.');
    }
    if (operation.kind !== 'protected' && operation.kind !== 'session') {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
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

    // A session route is open to every member the global TECH/DEMO restrictions let through, even without a domain role.
    const allowed =
      operation.kind === 'protected'
        ? operation.principals.includes('USER') &&
          isOperationAllowed(operation, access, {
            method: request.method,
            path: request.path ?? request.url?.split('?')[0] ?? '',
          })
        : access.role === null ||
          !operation.legacy ||
          operation.legacy.includes(access.role);
    if (!allowed) {
      throw new ForbiddenException('Missing permission for this operation.');
    }
    return true;
  }
}
