import { canContact } from './customer-consent.permissions.js';

describe('canContact', () => {
  it('blocks marketing without a grant', () => {
    const result = canContact({
      purpose: 'MARKETING',
      channel: 'EMAIL',
      events: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MARKETING_PERMISSION_MISSING');
  });

  it('allows marketing with explicit grant', () => {
    const result = canContact({
      purpose: 'MARKETING',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'MARKETING',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
        },
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it('opt-out (REVOKED) takes precedence over an earlier grant', () => {
    const result = canContact({
      purpose: 'MARKETING',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'MARKETING',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
        },
        {
          purpose: 'MARKETING',
          channel: 'EMAIL',
          status: 'REVOKED',
          sequence: 2,
        },
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('CONTACT_WITHDRAWN');
  });

  it('allows transactional email with contract grant', () => {
    const result = canContact({
      purpose: 'TRANSACTIONAL',
      channel: 'EMAIL',
      events: [
        {
          purpose: 'TRANSACTIONAL',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
        },
      ],
    });
    expect(result.allowed).toBe(true);
  });
});
