import { readNotificationDeliveryConfig } from './notification-delivery.config.js';

describe('readNotificationDeliveryConfig()', () => {
  it('fails closed on an empty environment', () => {
    expect(readNotificationDeliveryConfig({})).toEqual({
      mode: 'off',
      liveProvider: 'brevo',
      allowlist: [],
      fromAddress: '',
    });
  });

  it('treats an unknown mode as off, and reads the rest', () => {
    expect(
      readNotificationDeliveryConfig({
        NOTIFICATION_EMAIL_MODE: 'on',
        NOTIFICATION_EMAIL_PROVIDER: 'ses',
        NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: 'a@example.at',
        NOTIFICATION_EMAIL_FROM_ADDRESS: ' kontakt@example.at ',
      }),
    ).toEqual({
      mode: 'off',
      liveProvider: 'ses',
      allowlist: ['a@example.at'],
      fromAddress: 'kontakt@example.at',
    });
  });

  it('reads live and fake modes', () => {
    expect(readNotificationDeliveryConfig({ NOTIFICATION_EMAIL_MODE: 'live' }).mode).toBe('live');
    expect(readNotificationDeliveryConfig({ NOTIFICATION_EMAIL_MODE: 'fake' }).mode).toBe('fake');
  });
});
