import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TenantContextService } from '../services/tenant-context.service';
import {
  PDF_TASK_KIND_KEY,
  type PdfTaskKind,
  verifyPdfTaskPayload,
} from './pdf-task-payload';

@Injectable()
export class PdfTaskTenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const claims = verifyPdfTaskPayload(request.body, secret);

    const expectedKind = this.reflector.getAllAndOverride<PdfTaskKind>(
      PDF_TASK_KIND_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (expectedKind && claims.kind !== expectedKind) {
      throw new ForbiddenException(
        'PDF task payload kind does not match this worker',
      );
    }

    const routeId = request.params?.id;
    if (routeId && claims.resourceId !== routeId) {
      throw new ForbiddenException(
        'PDF task payload resource does not match this worker',
      );
    }

    const headerTenant = readHeader(request, 'x-tenant-id');
    if (headerTenant && headerTenant !== claims.tenantId) {
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
