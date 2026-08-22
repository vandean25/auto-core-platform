import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import * as crypto from 'node:crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
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
      console.error(
        'API_KEY environment variable is not set. All requests will be rejected.',
      );
      throw new UnauthorizedException('Unauthorized');
    }

    const providedHeader = Array.isArray(apiKey) ? apiKey[0] : apiKey;
    const providedKey =
      typeof providedHeader === 'string' ? providedHeader : '';
    const expectedHash = crypto
      .createHash('sha256')
      .update(validApiKey)
      .digest();
    const providedHash = crypto
      .createHash('sha256')
      .update(providedKey)
      .digest();
    if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
