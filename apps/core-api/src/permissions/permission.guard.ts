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
import type { OperationEntry } from './operation-types.js';
import {
  PermissionResolver,
  isMemberAllowed,
  type EffectiveAccess,
} from './permission-resolver.js';

type MemberRequest = Request & { user?: AuthenticatedUser };

/** Kinds a tenant principal is authorized for here; every other kind is left to its own guard. */
const MEMBER_ROUTE_KINDS: ReadonlySet<OperationEntry['kind']> = new Set([
  'protected',
  'session',
  'api_key',
]);

/**
 * Authorizes a request from the 1a operation table. Not registered anywhere yet (AUT-865/866 switch consumers).
 * A granted permission is necessary only: tenant, site, employee and business-state checks stay in the services.
 * Routes outside tenant roles keep their own guard (public and MCP transport, Cloud Tasks and cron workers,
 * platform admin, tenant API key scope). A tenant principal is never a worker, and a tenant API key
 * (ADR-0026) is never a tenant member.
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
    const request = context.switchToHttp().getRequest<MemberRequest>();
    const user = request.user;
    if (this.isLeftToOwnGuard(operation, user)) {
      return true;
    }
    const tenantId = user?.tenantId;
    if (!user || !tenantId || !MEMBER_ROUTE_KINDS.has(operation.kind)) {
      throw new ForbiddenException('Missing permission for this operation.');
    }
    if (isApiKeyPrincipal(user)) {
      // The key's scope was checked by the API key guard; on every other route it is not a member.
      if (operation.kind === 'api_key') {
        return true;
      }
      throw new ForbiddenException('A tenant member session is required.');
    }
    const access = await this.resolveMember(request, user.userId, tenantId);
    const path = request.path ?? request.url?.split('?')[0] ?? '';
    if (!isMemberAllowed(operation, access, { method: request.method, path })) {
      throw new ForbiddenException('Missing permission for this operation.');
    }
    return true;
  }

  /** Public routes and the MCP transport admit every caller; worker and platform routes admit non-tenant callers. */
  private isLeftToOwnGuard(
    operation: OperationEntry,
    user: AuthenticatedUser | undefined,
  ): boolean {
    switch (operation.kind) {
      case 'public':
      case 'mcp_gateway':
        return true;
      case 'service_job':
        return !user?.tenantId;
      case 'platform_admin':
        return user?.platformRole === 'SUPER_ADMIN';
      default:
        return false;
    }
  }

  private async resolveMember(
    request: MemberRequest,
    userId: string,
    tenantId: string,
  ): Promise<EffectiveAccess> {
    const access = await this.resolver.resolve(request, { userId, tenantId });
    if (!access) {
      throw new ForbiddenException('Active tenant membership is required.');
    }
    return access;
  }
}
