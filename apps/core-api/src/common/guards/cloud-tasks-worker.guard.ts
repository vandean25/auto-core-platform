import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class CloudTasksWorkerGuard implements CanActivate {
  private readonly logger = new Logger(CloudTasksWorkerGuard.name);

  canActivate(context: ExecutionContext) {
    const secret = process.env.CLOUD_TASKS_WORKER_SECRET;
    if (!secret) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const rawHeader = request.headers['x-cloud-tasks-secret'];
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const providedSecret = typeof headerToken === 'string' ? headerToken : '';

    const expectedHash = crypto.createHash('sha256').update(secret).digest();
    const providedHash = crypto
      .createHash('sha256')
      .update(providedSecret)
      .digest();

    if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
      this.logger.warn(
        `Invalid Cloud Tasks worker secret attempt from IP: ${request.ip} for route: ${request.originalUrl}`,
      );
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
