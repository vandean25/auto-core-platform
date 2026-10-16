import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  isApiKeyPrincipal,
  type AuthenticatedUser,
} from '../types/authenticated-user.js';

@Injectable()
export class InteractiveUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (isApiKeyPrincipal(request.user)) {
      throw new ForbiddenException(
        'Tenant API keys cannot access user preference endpoints.',
      );
    }
    if (!request.user?.userId) {
      throw new ForbiddenException('Interactive user session is required.');
    }
    return true;
  }
}
