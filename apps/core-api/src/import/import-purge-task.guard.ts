import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  verifyImportPurgeTaskPayload,
  type SignedImportPurgeTaskPayload,
} from './import-purge-task.payload.js';

@Injectable()
export class ImportPurgeTaskGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const body: unknown = request.body;
    if (!body || typeof body !== 'object') {
      throw new UnauthorizedException('Import purge task payload is required');
    }

    try {
      verifyImportPurgeTaskPayload(
        body as SignedImportPurgeTaskPayload,
        secret,
      );
    } catch {
      throw new UnauthorizedException('Invalid import purge task signature');
    }

    return true;
  }
}
