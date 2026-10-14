import type { ExecutionContext } from '@nestjs/common';
import {
  ESTIMATE_APPROVAL_IP_THROTTLER,
  ESTIMATE_APPROVAL_THROTTLER_OPTIONS,
  ESTIMATE_APPROVAL_TOKEN_PATTERN,
  isPublicEstimateApprovalRequest,
} from './public-estimate-approval.constants.js';

function contextFor(url: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url, url }),
    }),
  } as unknown as ExecutionContext;
}

describe('public estimate approval throttling and token shape', () => {
  it('applies the per-IP throttler only to the public approval route', () => {
    const skipIf = ESTIMATE_APPROVAL_THROTTLER_OPTIONS.skipIf;

    expect(ESTIMATE_APPROVAL_THROTTLER_OPTIONS.name).toBe(
      ESTIMATE_APPROVAL_IP_THROTTLER,
    );
    expect(skipIf?.(contextFor('/api/public/estimate-approvals/abc?x=1'))).toBe(
      false,
    );
    expect(skipIf?.(contextFor('/api/auth/me'))).toBe(true);
    expect(skipIf?.(contextFor('/api/public/v1/customers'))).toBe(true);
  });

  it('recognises the route from its original url, with or without a query string', () => {
    expect(
      isPublicEstimateApprovalRequest({
        originalUrl: '/api/public/estimate-approvals/token',
        url: '/public/estimate-approvals/token',
      }),
    ).toBe(true);
    expect(
      isPublicEstimateApprovalRequest({
        originalUrl: '/api/workshop/estimates/1/send',
        url: '/workshop/estimates/1/send',
      }),
    ).toBe(false);
  });

  it('matches the route in any letter case, because Express routes it that way', () => {
    expect(
      isPublicEstimateApprovalRequest({
        originalUrl: '/API/Public/ESTIMATE-approvals/token',
        url: '/API/Public/ESTIMATE-approvals/token',
      }),
    ).toBe(true);
  });

  it('matches the route in absolute form, which a forward proxy sends', () => {
    expect(
      isPublicEstimateApprovalRequest({
        originalUrl: 'http://api.example.test/api/public/estimate-approvals/token?x=1',
        url: 'http://api.example.test/api/public/estimate-approvals/token?x=1',
      }),
    ).toBe(true);
    expect(
      isPublicEstimateApprovalRequest({
        originalUrl: 'http://api.example.test/api/workshop/estimates/1/send',
        url: 'http://api.example.test/api/workshop/estimates/1/send',
      }),
    ).toBe(false);
  });

  it('applies the per-IP throttler to the route in absolute form too', () => {
    const skipIf = ESTIMATE_APPROVAL_THROTTLER_OPTIONS.skipIf;

    expect(
      skipIf?.(contextFor('http://api.example.test/api/public/estimate-approvals/abc')),
    ).toBe(false);
  });

  it('accepts only 43 base64url characters as a raw token', () => {
    const valid = 'A'.repeat(42) + '-';

    expect(ESTIMATE_APPROVAL_TOKEN_PATTERN.test(valid)).toBe(true);
    expect(ESTIMATE_APPROVAL_TOKEN_PATTERN.test('A'.repeat(42))).toBe(false);
    expect(ESTIMATE_APPROVAL_TOKEN_PATTERN.test('A'.repeat(42) + '+')).toBe(
      false,
    );
    expect(ESTIMATE_APPROVAL_TOKEN_PATTERN.test('A'.repeat(44))).toBe(false);
  });
});
