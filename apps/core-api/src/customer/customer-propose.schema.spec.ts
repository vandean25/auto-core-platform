import { toJSONSchema } from 'zod/v4-mini';
import {
  proposeCustomerCreateInputSchema,
  proposeCustomerUpdateInputSchema,
} from './customer-propose.schema.js';

const VALID_CREATE = {
  customer_type: 'PRIVATE',
  first_name: 'Max',
  last_name: 'Mustermann',
  email: 'max@example.at',
  phone: '+43 664 123456',
  address: { street: 'Mustergasse 1', zip: '1010', city: 'Wien', country: 'AT' },
  preferred_language: 'de',
  idempotency_key: 'aut613-create-1',
};

const VALID_UPDATE = {
  customer_id: '00000000-0000-4000-8000-000000000040',
  changes: { email: 'neu@example.at' },
  reason: 'Kunde meldet neue Adresse',
  idempotency_key: 'aut613-update-1',
};

describe('customer proposal schemas (AUT-613)', () => {
  it('accepts a complete create input', () => {
    expect(proposeCustomerCreateInputSchema.safeParse(VALID_CREATE).success).toBe(
      true,
    );
  });

  it('accepts a complete update input', () => {
    expect(proposeCustomerUpdateInputSchema.safeParse(VALID_UPDATE).success).toBe(
      true,
    );
  });

  it('requires the identity fields of a create', () => {
    const { first_name: _first, last_name: _last, ...withoutName } = VALID_CREATE;
    expect(
      proposeCustomerCreateInputSchema.safeParse(withoutName).success,
    ).toBe(false);
  });

  it('requires an idempotency key', () => {
    const { idempotency_key: _key, ...withoutKey } = VALID_CREATE;
    expect(proposeCustomerCreateInputSchema.safeParse(withoutKey).success).toBe(
      false,
    );
  });

  it('rejects a consent field on create', () => {
    const result = proposeCustomerCreateInputSchema.safeParse({
      ...VALID_CREATE,
      contact_email_ok: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => issue.message)
        .join(' ');
      expect(message).toContain('contact_email_ok');
    }
  });

  it('rejects a consent field in the changes of an update', () => {
    const result = proposeCustomerUpdateInputSchema.safeParse({
      ...VALID_UPDATE,
      changes: { email: 'neu@example.at', contact_email_ok: true },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map((issue) => issue.message).join(' '),
      ).toContain('contact_email_ok');
    }
  });

  it('rejects marketing consent data', () => {
    const result = proposeCustomerCreateInputSchema.safeParse({
      ...VALID_CREATE,
      marketing_consent: { granted: true },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown field', () => {
    const result = proposeCustomerCreateInputSchema.safeParse({
      ...VALID_CREATE,
      legacy_number: 'A-1',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed e-mail and a malformed customer id', () => {
    expect(
      proposeCustomerCreateInputSchema.safeParse({
        ...VALID_CREATE,
        email: 'not-an-email',
      }).success,
    ).toBe(false);
    expect(
      proposeCustomerUpdateInputSchema.safeParse({
        ...VALID_UPDATE,
        customer_id: 'nope',
      }).success,
    ).toBe(false);
  });

  it('publishes a closed schema with additionalProperties false', () => {
    const jsonSchema = toJSONSchema(proposeCustomerCreateInputSchema, {
      target: 'draft-7',
      io: 'input',
    });
    expect(jsonSchema).toMatchObject({ additionalProperties: false });
  });
});
