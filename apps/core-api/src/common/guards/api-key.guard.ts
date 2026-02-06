import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
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
