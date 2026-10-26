import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getRequiredCloudTasksEnv } from '../common/services/cloud-tasks.config.js';
import { verifyImportTaskPayload } from './import-task.payload.js';

@Injectable()
export class ImportTaskGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ body: unknown }>();
    const body = request.body;
    if (!body || typeof body !== 'object') {
      throw new UnauthorizedException('Import task payload is required');
    }
    try {
      const env = getRequiredCloudTasksEnv();
      verifyImportTaskPayload(body as never, env.workerSecret);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid import task signature');
    }
  }
}
