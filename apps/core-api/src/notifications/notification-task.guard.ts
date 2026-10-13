import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { verifyNotificationTaskPayload } from './notification-task.payload.js';

/**
 * Application authentication for notification worker calls (ADR-0007 pattern). Runs after
 * CloudTasksWorkerGuard. Binds the tenant from the signed payload, never from a header alone.
 */
@Injectable()
export class NotificationTaskGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const claims = verifyNotificationTaskPayload(request.body, secret);

    if (request.params?.outboxId !== claims.outboxId) {
      throw new ForbiddenException(
        'Notification task payload does not match this route',
      );
    }
    // Cloud Tasks always sends the header (buildTaskRequest); a call without it is not a task.
    const headerTenant = readHeader(request, 'x-tenant-id');
    if (headerTenant !== claims.tenantId) {
      throw new ForbiddenException(
        'Tenant id header does not match signed task payload',
      );
    }

    this.tenantContext.setTenantIdForWorker(claims.tenantId);
    return true;
  }
}

function readHeader(request: Request, name: string): string {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}
