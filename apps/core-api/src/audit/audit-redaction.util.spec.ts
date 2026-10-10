import {
  MASKED_PII_VALUE,
  REDACTED_VALUE,
  maskAuditPiiForMcp,
  maskEmailAddress,
  maskPhoneNumber,
  redactAuditSecrets,
} from './audit-redaction.util.js';

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

describe('maskAuditPiiForMcp', () => {
  it('masks an email address to its first letter and its domain', () => {
    expect(maskEmailAddress('john.doe@example.com')).toBe('j***@example.com');
    expect(maskEmailAddress('not-an-email')).toBe(MASKED_PII_VALUE);
  });

  it('keeps only the last two digits of a phone number', () => {
    expect(maskPhoneNumber('+43 660 1234567')).toBe('+** *** *****67');
    expect(maskPhoneNumber('0660 1234567')).toBe('**** *****67');
    expect(maskPhoneNumber('12')).toBe(MASKED_PII_VALUE);
  });

  it('masks contact and address fields at any depth and reports their paths', () => {
    const { value, maskedPaths } = maskAuditPiiForMcp({
      contacts: [
        { email: 'jane@example.org', phone: '0660 1234567', nickname: 'JJ' },
      ],
      address: { street: 'Hauptplatz 1', city: 'Linz' },
      customer_name: 'Jane Beispiel',
    });

    expect(value).toEqual({
      contacts: [
        { email: 'j***@example.org', phone: '**** *****67', nickname: 'JJ' },
      ],
      address: MASKED_PII_VALUE,
      customer_name: 'Jane Beispiel',
    });
    expect(maskedPaths).toEqual([
      'address',
      'contacts[0].email',
      'contacts[0].phone',
    ]);
  });

  it('scrubs email addresses wherever they appear in text', () => {
    expect(maskAuditPiiForMcp('Mail john.doe@example.com today').value).toBe(
      'Mail j***@example.com today',
    );
  });

  it('masks a whole-value phone number that has no field name', () => {
    expect(maskAuditPiiForMcp('+43 660 1234567').value).toBe(
      '+** *** *****67',
    );
  });

  it('leaves identifiers, dates, amounts, and plain text unchanged', () => {
    const input = {
      address_id: '00000000-0000-4000-8000-0000000000c1',
      order_id: '00000000-0000-4000-8000-0000000000c2',
      due_date: '2026-10-12',
      amount: '1250.00',
      invoice_no: '20260001234',
      notes: 'normal business note',
    };

    const { value, maskedPaths } = maskAuditPiiForMcp(input);

    expect(value).toEqual(input);
    expect(maskedPaths).toEqual([]);
  });

  it('masks an email with a non-ASCII local part without leaving any of it readable', () => {
    expect(
      maskAuditPiiForMcp('Mail jürgen.müller@beispiel.de heute').value,
    ).toBe('Mail j***@beispiel.de heute');
    expect(
      maskAuditPiiForMcp({ email: 'jürgen.müller@beispiel.de' }).value,
    ).toEqual({ email: 'j***@beispiel.de' });
  });

  it('masks an email-named field as a whole, including apostrophes and text around the address', () => {
    expect(maskAuditPiiForMcp({ email: "o'brien@example.org" }).value).toEqual({
      email: 'o***@example.org',
    });
    expect(
      maskAuditPiiForMcp({ email: 'Jane Doe <jane@example.org>' }).value,
    ).toEqual({ email: 'J***@example.org>' });
  });

  it('masks a long local part in free text without a readable prefix', () => {
    const localPart = 'a'.repeat(100);

    expect(maskAuditPiiForMcp(`${localPart}@example.com`).value).toBe(
      'a***@example.com',
    );
  });

  it('scans a long run of letters with no @ in linear time', () => {
    const input = 'a'.repeat(200_000);
    const start = performance.now();

    const { value, maskedPaths } = maskAuditPiiForMcp(input);

    expect(value).toBe(input);
    expect(maskedPaths).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
