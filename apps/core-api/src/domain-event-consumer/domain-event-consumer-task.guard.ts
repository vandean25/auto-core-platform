import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { verifyDomainEventConsumerTaskPayload } from './domain-event-consumer-task.payload.js';

@Injectable()
export class DomainEventConsumerTaskGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }
    const request = context.switchToHttp().getRequest<Request>();
    const claims = verifyDomainEventConsumerTaskPayload(request.body, secret);
    const routeConsumer = decodeURIComponent(
      String(request.params?.consumerKey ?? ''),
    );
    if (routeConsumer !== claims.consumerKey) {
      throw new ForbiddenException(
        'Domain event consumer task payload does not match this route',
      );
    }
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
