import { BadRequestException } from '@nestjs/common';
import {
  assertValidCommunicationEventRequest,
  marketingGrantProofComplete,
} from './customer-consent-event-validation.js';

describe('assertValidCommunicationEventRequest', () => {
  const base = {
    expected_revision: 0,
    idempotency_key: 'k1',
    channel: 'EMAIL' as const,
    purpose: 'NEWSLETTER' as const,
    source: 'PROFILE' as const,
  };

  it('rejects marketing GRANTED without consent text', () => {
    expect(() =>
      assertValidCommunicationEventRequest({
        ...base,
        status: 'GRANTED',
        basis: 'CONSENT',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects marketing GRANTED with IMPORT source and missing basis proof', () => {
    expect(() =>
      assertValidCommunicationEventRequest({
        ...base,
        status: 'GRANTED',
        source: 'IMPORT',
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts marketing GRANTED with consent basis and text proof', () => {
    expect(() =>
      assertValidCommunicationEventRequest({
        ...base,
        status: 'GRANTED',
        basis: 'CONSENT',
        text_version: 'v1',
        text_snapshot: 'Shown wording',
      }),
    ).not.toThrow();
  });
});

describe('marketingGrantProofComplete', () => {
  it('is false when GRANTED lacks snapshot', () => {
    expect(
      marketingGrantProofComplete({
        status: 'GRANTED',
        basis: 'CONSENT',
        text_version: 'v1',
        text_snapshot: '',
      }),
    ).toBe(false);
  });
});
