import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { verifyImportTaskPayload } from './import-task.payload.js';

@Injectable()
export class ImportTaskGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const body: unknown = request.body;
    if (!body || typeof body !== 'object') {
      throw new UnauthorizedException('Import task payload is required');
    }

    let claims;
    try {
      claims = verifyImportTaskPayload(body as never, secret);
    } catch {
      throw new UnauthorizedException('Invalid import task signature');
    }

    this.tenantContext.setTenantIdForWorker(claims.tenantId);
    return true;
  }
}
