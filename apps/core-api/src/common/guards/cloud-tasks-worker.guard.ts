import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class CloudTasksWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-cloud-tasks-secret'];

    if (typeof header !== 'string' || header !== secret) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
