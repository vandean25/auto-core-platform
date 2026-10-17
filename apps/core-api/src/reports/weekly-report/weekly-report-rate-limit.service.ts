import {
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PublicRateLimitStore } from '../../landing-demo-access/public-rate-limit.store.js';

const RATE_LIMIT_SCOPE = 'mcp_weekly_report_pdf';
const MAX_PER_WINDOW = 12;
const WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class WeeklyReportRateLimitService {
  constructor(private readonly rateLimits: PublicRateLimitStore) {}

  async assertAllowed(tenantId: string, now = new Date()): Promise<void> {
    const decision = await this.rateLimits.consume(
      { scope: RATE_LIMIT_SCOPE, key: tenantId },
      { max: MAX_PER_WINDOW, ttlMs: WINDOW_MS },
      now,
    );
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'WEEKLY_REPORT_RATE_LIMIT',
          message: `Weekly report PDF generation is rate limited. Retry after ${decision.retryAfterSeconds} seconds.`,
          retry_after_seconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
