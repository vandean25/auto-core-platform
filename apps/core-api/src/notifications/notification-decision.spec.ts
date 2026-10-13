import { decideEmailDelivery } from './notification-decision.js';

const recipient = 'kunde@example.at';

describe('decideEmailDelivery()', () => {
  it('suppresses everything while the mode is off', () => {
    expect(
      decideEmailDelivery({
        mode: 'off',
        liveProvider: 'brevo',
        allowlist: [recipient],
        recipientEmail: recipient,
      }),
    ).toEqual({ action: 'suppress', reason: 'EMAIL_DISABLED' });
  });

  it('uses only the in-memory provider in fake mode, whatever the allowlist', () => {
    expect(
      decideEmailDelivery({
        mode: 'fake',
        liveProvider: 'ses',
        allowlist: [],
        recipientEmail: recipient,
      }),
    ).toEqual({ action: 'send', provider: 'fake' });
  });

  it('sends live only to allowlisted recipients, and fails closed otherwise', () => {
    const base = {
      mode: 'live' as const,
      liveProvider: 'ses' as const,
      recipientEmail: recipient,
    };
    expect(decideEmailDelivery({ ...base, allowlist: [] })).toEqual({
      action: 'suppress',
      reason: 'RECIPIENT_NOT_ALLOWLISTED',
    });
    expect(decideEmailDelivery({ ...base, allowlist: [recipient] })).toEqual({
      action: 'send',
      provider: 'ses',
    });
  });
});
