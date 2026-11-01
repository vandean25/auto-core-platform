import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { ScheduledJobTriggerService } from './scheduled-job-trigger.service.js';

/**
 * Global interceptor that opportunistically checks and triggers due scheduled jobs
 * on incoming HTTP traffic (AUT-839).
 * Non-blocking fire-and-forget: never delays or fails an incoming request.
 */
@Injectable()
export class ScheduledJobTriggerInterceptor implements NestInterceptor {
  constructor(private readonly triggerService: ScheduledJobTriggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      this.triggerService.triggerOpportunisticFromRequest();
    }
    return next.handle();
  }
}
