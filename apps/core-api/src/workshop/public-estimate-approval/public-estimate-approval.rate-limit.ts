import { Injectable } from '@nestjs/common';

type Window = { startedAt: number; count: number };

const MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window counter per approval token (ADR-0025 §7: throttle per token as well as per IP). It lives in
 * this process, so with several instances each one enforces the limit on its own. The 256-bit token is the
 * main defence against guessing; this bounds scraping and repeated decision attempts on one link. Keys are
 * token hashes, and the map is bounded, so memory stays flat under many links.
 */
@Injectable()
export class PublicEstimateApprovalRateLimiter {
  private readonly windows = new Map<string, Window>();

  /** Returns true when the attempt is allowed and counts it. */
  consume(key: string, limit: number, windowMs: number, now: number): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.remember(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= limit) {
      return false;
    }
    current.count += 1;
    return true;
  }

  private remember(key: string, window: Window): void {
    if (!this.windows.has(key) && this.windows.size >= MAX_TRACKED_KEYS) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) {
        this.windows.delete(oldest);
      }
    }
    this.windows.set(key, window);
  }
}
