import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isPublicEstimateApprovalRequest } from './public-estimate-approval.constants.js';

/**
 * Headers for every answer of the public approval route, errors included. This is middleware and not an
 * interceptor, because the global throttler answers 429 before any interceptor runs (ADR-0025 §7): no caching,
 * no search indexing, and no referrer that would leak the token.
 */
@Injectable()
export class PublicEstimateApprovalHeadersMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    if (isPublicEstimateApprovalRequest(request)) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  }
}
