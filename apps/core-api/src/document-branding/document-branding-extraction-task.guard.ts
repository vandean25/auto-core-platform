import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { verifyDocumentBrandingExtractionTask } from './document-branding-extraction-task.js';

@Injectable()
export class DocumentBrandingExtractionTaskGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) throw new InternalServerErrorException();
    const request = context.switchToHttp().getRequest<Request>();
    const claims = verifyDocumentBrandingExtractionTask(request.body, secret);
    if (
      claims.extractionId !== request.params.extractionId ||
      claims.legalEntityId !== request.params.legalEntityId
    ) {
      throw new ForbiddenException(
        'Document branding task identity does not match the route',
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

function readHeader(request: Request, name: string): string {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}
