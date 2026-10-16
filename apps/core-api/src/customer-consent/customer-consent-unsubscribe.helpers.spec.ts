import {
  buildUnsubscribeIdempotencyKey,
  marketingPurposeNeedsUnsubscribe,
} from './customer-consent-unsubscribe.helpers.js';

describe('unsubscribe idempotency keys', () => {
  it('scopes idempotency to the superseded grant sequence', () => {
    expect(buildUnsubscribeIdempotencyKey('abc', 'NEWSLETTER', 2)).toBe(
      'unsubscribe:abc:NEWSLETTER:after-seq:2',
    );
    expect(buildUnsubscribeIdempotencyKey('abc', 'NEWSLETTER', 5)).not.toBe(
      buildUnsubscribeIdempotencyKey('abc', 'NEWSLETTER', 2),
    );
  });

  it('needs a new withdraw when latest event is a grant', () => {
    const events = [
      {
        purpose: 'NEWSLETTER' as const,
        channel: 'EMAIL' as const,
        status: 'REVOKED' as const,
        sequence: 1,
      },
      {
        purpose: 'NEWSLETTER' as const,
        channel: 'EMAIL' as const,
        status: 'GRANTED' as const,
        sequence: 2,
        basis: 'CONSENT' as const,
        text_version: 'v1',
        text_snapshot: 'text',
      },
    ];
    expect(
      marketingPurposeNeedsUnsubscribe(events, 'NEWSLETTER', 'EMAIL'),
    ).toEqual({ needed: true, supersededSequence: 2 });
  });

  it('does not need withdraw when already revoked', () => {
    const events = [
      {
        purpose: 'NEWSLETTER' as const,
        channel: 'EMAIL' as const,
        status: 'REVOKED' as const,
        sequence: 3,
      },
    ];
    expect(
      marketingPurposeNeedsUnsubscribe(events, 'NEWSLETTER', 'EMAIL').needed,
    ).toBe(false);
  });
});
