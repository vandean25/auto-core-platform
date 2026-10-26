import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class CronInvokerOidcGuard implements CanActivate {
  private readonly logger = new Logger(CronInvokerOidcGuard.name);
  private readonly client = new OAuth2Client();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const audience = process.env.CRON_OIDC_AUDIENCE?.trim();
    const invokerEmail = process.env.CRON_INVOKER_SA_EMAIL?.trim();
    if (!audience || !invokerEmail) {
      throw new InternalServerErrorException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = readBearerToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience,
      });
      const payload = ticket.getPayload();
      if (payload?.email !== invokerEmail || payload.email_verified !== true) {
        this.logger.warn(
          `Rejected cron OIDC token for route ${request.originalUrl}`,
        );
        throw new UnauthorizedException();
      }
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.warn(
        `Invalid cron OIDC token for route ${request.originalUrl}`,
      );
      throw new UnauthorizedException();
    }
  }
}

function readBearerToken(request: Request): string | undefined {
  const raw = request.headers.authorization;
  const header = readAuthorizationHeaderValue(raw);
  if (!header) {
    return undefined;
  }
  const trimmed = header.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex <= 0) {
    return undefined;
  }
  if (trimmed.slice(0, spaceIndex).toLowerCase() !== 'bearer') {
    return undefined;
  }
  const token = trimmed.slice(spaceIndex + 1).trim();
  return token || undefined;
}

function readAuthorizationHeaderValue(
  raw: string | string[] | undefined,
): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw[0];
  }
  return undefined;
}
