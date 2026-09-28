import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { verifyDocumentBrandingUploadTask } from './document-branding-upload-task.js';

@Injectable()
export class DocumentBrandingUploadTaskGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext) {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) throw new InternalServerErrorException();
    const request = context.switchToHttp().getRequest<Request>();
    const claims = verifyDocumentBrandingUploadTask(request.body, secret);
    if (claims.assetId !== request.params.assetId) {
      throw new ForbiddenException(
        'Document branding task asset does not match the route',
      );
    }
    if (readHeader(request, 'x-tenant-id') !== claims.tenantId) {
      throw new ForbiddenException(
        'Document branding task tenant does not match the request',
      );
    }
    this.tenantContext.setTenantIdForWorker(claims.tenantId);
    return true;
  }
}

function readHeader(request: Request, name: string) {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}
