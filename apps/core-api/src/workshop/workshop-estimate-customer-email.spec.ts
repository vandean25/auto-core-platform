import { UnprocessableEntityException } from '@nestjs/common';
import {
  buildCustomerEstimateEmail,
  type CustomerEstimateEmailInput,
} from './workshop-estimate-customer-email.js';

const INPUT: CustomerEstimateEmailInput = {
  customer: { contact_email_ok: true, email: 'max.muster@example.at' },
  vehicle: { make: 'VW', model: 'Golf' },
  sellerName: 'Werkstatt Muster',
  estimateNumber: 'KV-2026-0001',
  approvalBaseUrl: 'https://portal.example.at',
  approvalToken: 'abc_DEF-123',
  validUntil: new Date('2026-10-27T09:00:00Z'),
};

function refusalOf(input: CustomerEstimateEmailInput): unknown {
  try {
    buildCustomerEstimateEmail(input);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the estimate email to be refused');
}

function refusalCode(input: CustomerEstimateEmailInput): unknown {
  const error = refusalOf(input);
  expect(error).toBeInstanceOf(UnprocessableEntityException);
  return (error as UnprocessableEntityException).getResponse();
}

describe('buildCustomerEstimateEmail (ADR-0025 §5, §6, §8)', () => {
  it('writes the estimate email to the customer with the approval link and no attachment', () => {
    const { recipientEmail, draft } = buildCustomerEstimateEmail(INPUT);

    expect(recipientEmail).toBe('max.muster@example.at');
    expect(draft.recipientEmail).toBe('max.muster@example.at');
    expect(draft.templateId).toBe('customer.estimate_sent');
    expect(draft.subject).toBe('Kostenvoranschlag KV-2026-0001');
    expect(draft.text).toContain('für Ihr Fahrzeug VW Golf');
    expect(draft.text).toContain(
      'einsehen: https://portal.example.at/approve/abc_DEF-123',
    );
    expect(draft.text).not.toMatch(/\banbei\b/i);
  });

  it('trims the customer address before writing it', () => {
    const { recipientEmail } = buildCustomerEstimateEmail({
      ...INPUT,
      customer: { contact_email_ok: true, email: ' max.muster@example.at ' },
    });

    expect(recipientEmail).toBe('max.muster@example.at');
  });

  it('refuses until the advisor has confirmed the address for order communication', () => {
    expect(
      refusalCode({
        ...INPUT,
        customer: { contact_email_ok: false, email: 'max.muster@example.at' },
      }),
    ).toMatchObject({ code: 'ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED' });
  });

  it('refuses a customer without an address', () => {
    for (const email of [null, '   ']) {
      expect(
        refusalCode({ ...INPUT, customer: { contact_email_ok: true, email } }),
      ).toMatchObject({ code: 'ESTIMATE_CUSTOMER_EMAIL_MISSING' });
    }
  });

  it('refuses an address that is not one plain address', () => {
    expect(
      refusalCode({
        ...INPUT,
        customer: { contact_email_ok: true, email: 'max muster@example.at' },
      }),
    ).toMatchObject({ code: 'ESTIMATE_CUSTOMER_EMAIL_INVALID' });
  });

  it('refuses a vehicle without a make or a model', () => {
    expect(
      refusalCode({ ...INPUT, vehicle: { make: '  ', model: 'Golf' } }),
    ).toMatchObject({ code: 'ESTIMATE_VEHICLE_INCOMPLETE' });
    expect(
      refusalCode({ ...INPUT, vehicle: { make: 'VW', model: '' } }),
    ).toMatchObject({ code: 'ESTIMATE_VEHICLE_INCOMPLETE' });
  });

  it('refuses a seller name that would break the email header', () => {
    expect(
      refusalCode({ ...INPUT, sellerName: 'Werkstatt\nBcc: x@example.at' }),
    ).toMatchObject({ code: 'ESTIMATE_EMAIL_INCOMPLETE' });
  });
});
