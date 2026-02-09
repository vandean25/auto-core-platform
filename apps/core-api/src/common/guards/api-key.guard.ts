import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global Guard that enforces API Key authentication on all routes
 * unless they are marked with @Public().
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * Determines if the current request is allowed to proceed.
   * Checks for @Public() decorator or validates the 'x-api-key' header.
   *
   * @param context - The execution context.
   * @returns boolean | Promise<boolean> | Observable<boolean> - True if allowed, throws UnauthorizedException otherwise.
   */
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

    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
