import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'];
    const validApiKey = process.env.API_KEY;

    if (!validApiKey) {
      this.logger.error(
        'API_KEY environment variable is not set. All requests will be rejected.',
      );
      throw new UnauthorizedException('Unauthorized');
    }

    const providedKey =
      typeof apiKey === 'string'
        ? apiKey
        : Array.isArray(apiKey)
          ? apiKey[0]
          : '';
    const expectedHash = crypto
      .createHash('sha256')
      .update(validApiKey)
      .digest();
    const providedHash = crypto
      .createHash('sha256')
      .update(providedKey)
      .digest();

    if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
      this.logger.warn(
        `Invalid API key attempt from IP: ${request.ip} for route: ${request.originalUrl}`,
      );
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
