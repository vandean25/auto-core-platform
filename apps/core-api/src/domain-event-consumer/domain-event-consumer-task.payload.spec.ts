import {
  signDomainEventConsumerTaskPayload,
  verifyDomainEventConsumerTaskPayload,
} from './domain-event-consumer-task.payload.js';

const SECRET = 'domain-event-consumer-test-secret';
const CLAIMS = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  consumerKey: 'workshop_estimate.decided.v1:internal_notice',
};
const VALID_SIGNATURE = signDomainEventConsumerTaskPayload(CLAIMS, SECRET)
  .signature;

describe('verifyDomainEventConsumerTaskPayload', () => {
  it('returns the signed claims for a valid signature', () => {
    const payload = signDomainEventConsumerTaskPayload(CLAIMS, SECRET);

    expect(verifyDomainEventConsumerTaskPayload(payload, SECRET)).toEqual(
      CLAIMS,
    );
  });

  it.each([
    { label: 'mismatched', signature: '0'.repeat(64) },
    { label: 'missing', signature: undefined },
    { label: 'non-string', signature: 123 },
    { label: 'non-hex', signature: `${VALID_SIGNATURE}z` },
    { label: 'wrong-length', signature: VALID_SIGNATURE.slice(1) },
  ])(
    'rejects a $label signature with a typed error instead of a retryable generic failure',
    ({ signature }) => {
      let error: unknown;
      try {
        verifyDomainEventConsumerTaskPayload({ ...CLAIMS, signature }, SECRET);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        name: 'InvalidDomainEventConsumerTaskSignatureError',
      });
    },
  );
});
