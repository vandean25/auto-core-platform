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
} from '../auth/types/authenticated-user.js';

export const TRANSCRIPT_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);

@Injectable()
export class VoiceTranscriptGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (
      !user ||
      isApiKeyPrincipal(user) ||
      !('role' in user) ||
      !user.role ||
      !TRANSCRIPT_ROLES.has(user.role)
    ) {
      throw new ForbiddenException(
        'Voice commands are available to OWNER, ADMIN, and SALES roles only.',
      );
    }
    return true;
  }
}
