import type { Request, Response } from 'express';
import { PublicEstimateApprovalHeadersMiddleware } from './public-estimate-approval.headers.middleware.js';

function runMiddleware(url: string) {
  const setHeader = jest.fn();
  const next = jest.fn();
  new PublicEstimateApprovalHeadersMiddleware().use(
    { originalUrl: url, url } as Request,
    { setHeader } as unknown as Response,
    next,
  );
  return { setHeader, next };
}

describe('PublicEstimateApprovalHeadersMiddleware', () => {
  it('sets no-store, no-referrer and noindex on the approval route before the request goes on', () => {
    const { setHeader, next } = runMiddleware(
      `/api/public/estimate-approvals/${'A'.repeat(43)}`,
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves every other route untouched', () => {
    const { setHeader, next } = runMiddleware('/api/workshop/estimates/1/send');

    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
