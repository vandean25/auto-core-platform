import { canContact } from './customer-consent.permissions.js';

describe('canContact', () => {
  it('blocks marketing without a grant', () => {
    const result = canContact({
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      events: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MARKETING_PERMISSION_MISSING');
  });

  it('allows marketing with explicit grant for the same purpose', () => {
    const result = canContact({
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
          basis: 'CONSENT',
          text_version: 'v1',
          text_snapshot: 'Shown consent text',
        },
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it('denies marketing GRANTED without consent wording proof', () => {
    const result = canContact({
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
          basis: 'CONSENT',
        },
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MARKETING_PERMISSION_MISSING');
  });

  it('does not allow newsletter grant to authorise service reminders', () => {
    const result = canContact({
      purpose: 'SERVICE_REMINDER',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
          basis: 'CONSENT',
          text_version: 'v1',
          text_snapshot: 'newsletter only',
        },
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MARKETING_PERMISSION_MISSING');
  });

  it('opt-out (REVOKED) takes precedence over an earlier grant', () => {
    const result = canContact({
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
          basis: 'CONSENT',
          text_version: 'v1',
          text_snapshot: 'text',
        },
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'REVOKED',
          sequence: 2,
        },
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('CONTACT_WITHDRAWN');
  });

  it('allows transactional order email from contact_email_ok projection', () => {
    const result = canContact({
      purpose: 'ORDER_COMMUNICATION',
      channel: 'EMAIL',
      events: [],
      transactionalProjection: { orderEmailConfirmed: true },
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks incomplete soft opt-in without all required facts', () => {
    const result = canContact({
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'SOFT_OPT_IN',
          sequence: 1,
          evidence: { obtained_with_sale: true },
        },
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SOFT_OPT_IN_INCOMPLETE');
  });

  it('allows soft opt-in when all required facts are present', () => {
    const result = canContact({
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'SOFT_OPT_IN',
          sequence: 1,
          evidence: {
            obtained_with_sale: true,
            own_similar_products: true,
            refusal_opportunity_at_collection: true,
            no_prior_refusal: true,
            own_similar_message_assessment: true,
          },
        },
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it('allows transactional email with contract grant in ledger', () => {
    const result = canContact({
      purpose: 'ORDER_COMMUNICATION',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'ORDER_COMMUNICATION',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
        },
      ],
    });
    expect(result.allowed).toBe(true);
  });
});
