import { describe, expect, it, jest } from '@jest/globals';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ScheduledJobTriggerInterceptor } from './scheduled-job-trigger.interceptor.js';
import type { ScheduledJobTriggerService } from './scheduled-job-trigger.service.js';

describe('ScheduledJobTriggerInterceptor', () => {
  it('calls triggerOpportunisticFromRequest on HTTP requests without awaiting or blocking', (done) => {
    const mockTriggerService = {
      triggerOpportunisticFromRequest: jest.fn(),
    };

    const interceptor = new ScheduledJobTriggerInterceptor(
      mockTriggerService as unknown as ScheduledJobTriggerService,
    );

    const mockContext = {
      getType: () => 'http',
    } as unknown as ExecutionContext;

    const mockNext: CallHandler = {
      handle: () => of({ ok: true }),
    };

    const stream$ = interceptor.intercept(mockContext, mockNext);
    expect(mockTriggerService.triggerOpportunisticFromRequest).toHaveBeenCalledTimes(1);

    stream$.subscribe({
      next: (val) => {
        expect(val).toEqual({ ok: true });
        done();
      },
      error: done,
    });
  });

  it('ignores non-HTTP execution contexts', (done) => {
    const mockTriggerService = {
      triggerOpportunisticFromRequest: jest.fn(),
    };

    const interceptor = new ScheduledJobTriggerInterceptor(
      mockTriggerService as unknown as ScheduledJobTriggerService,
    );

    const mockContext = {
      getType: () => 'ws',
    } as unknown as ExecutionContext;

    const mockNext: CallHandler = {
      handle: () => of({ ok: true }),
    };

    const stream$ = interceptor.intercept(mockContext, mockNext);
    expect(mockTriggerService.triggerOpportunisticFromRequest).not.toHaveBeenCalled();

    stream$.subscribe({
      next: () => done(),
      error: done,
    });
  });
});
