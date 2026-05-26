import {
  REDACTED_VALUE,
  redactAuditSecrets,
} from './audit-redaction.util';

describe('redactAuditSecrets', () => {
  it('redacts nested secret fields and returns redacted paths', () => {
    const input = {
      customer_name: 'Jane',
      credentials: {
        password: 'secret',
        passwordResetToken: 'reset-token',
        refresh_token: 'refresh-token',
      },
      headers: [
        { authorization: 'Bearer abc' },
        { 'x-api-key': 'api-key' },
      ],
      vehicle: {
        vin: 'WVWZZZ1JZXW000001',
      },
    };

    const { value, redactedPaths } = redactAuditSecrets(input);

    expect(value).toEqual({
      customer_name: 'Jane',
      credentials: {
        password: REDACTED_VALUE,
        passwordResetToken: REDACTED_VALUE,
        refresh_token: REDACTED_VALUE,
      },
      headers: [
        { authorization: REDACTED_VALUE },
        { 'x-api-key': REDACTED_VALUE },
      ],
      vehicle: {
        vin: 'WVWZZZ1JZXW000001',
      },
    });
    expect(redactedPaths).toEqual([
      'credentials.password',
      'credentials.passwordResetToken',
      'credentials.refresh_token',
      'headers[0].authorization',
      'headers[1].x-api-key',
    ]);
  });

  it('does not redact non-secret business fields', () => {
    const input = {
      status: 'COMPLETED',
      quantity: 5,
      unit_price: 10.5,
      customer_name: 'John Doe',
      notes: 'normal business note',
      line_items: [{ sku: 'A-1', quantity: 2 }],
    };

    const { value, redactedPaths } = redactAuditSecrets(input);

    expect(value).toEqual(input);
    expect(redactedPaths).toEqual([]);
  });
});
