import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { PublicEstimateApprovalHeadersInterceptor } from './public-estimate-approval.headers.interceptor.js';

describe('PublicEstimateApprovalHeadersInterceptor', () => {
  it('sets no-store, no-referrer and noindex before the handler runs', async () => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
    } as unknown as ExecutionContext;
    const handler = { handle: () => of({ ok: true }) } as CallHandler;

    const result = await lastValueFrom(
      new PublicEstimateApprovalHeadersInterceptor().intercept(
        context,
        handler,
      ),
    );

    expect(result).toEqual({ ok: true });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow');
  });
});
