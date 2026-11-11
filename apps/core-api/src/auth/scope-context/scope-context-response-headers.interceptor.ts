import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

@Injectable()
export class ScopeContextResponseHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('Cache-Control', 'private, no-store');
    }
    return next.handle();
  }
}
