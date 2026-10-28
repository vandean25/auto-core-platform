import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto.js';
import { UpdateCustomerDto } from './update-customer.dto.js';

const CREATE_BASE = { first_name: 'Max', last_name: 'Muster' };

async function failingProperties(
  dto: ClassConstructor<object>,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));
  return errors.map((error) => error.property);
}

describe('contact_email_ok on the customer DTOs (ADR-0025 §8)', () => {
  it('refuses null on create, where IsOptional would have let it reach the NOT NULL column', async () => {
    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        contact_email_ok: null,
      }),
    ).toEqual(['contact_email_ok']);
  });

  it('refuses null on update, where the inherited PartialType rule would have skipped it', async () => {
    expect(
      await failingProperties(UpdateCustomerDto, { contact_email_ok: null }),
    ).toEqual(['contact_email_ok']);
  });

  it('refuses a non-boolean value on update', async () => {
    expect(
      await failingProperties(UpdateCustomerDto, { contact_email_ok: 'ja' }),
    ).toEqual(['contact_email_ok']);
  });

  it('accepts a boolean, or no flag at all, on both DTOs', async () => {
    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        contact_email_ok: true,
      }),
    ).toEqual([]);
    expect(await failingProperties(CreateCustomerDto, CREATE_BASE)).toEqual([]);
    expect(
      await failingProperties(UpdateCustomerDto, { contact_email_ok: false }),
    ).toEqual([]);
    expect(await failingProperties(UpdateCustomerDto, {})).toEqual([]);
  });
});

describe('blank email on the customer DTOs (AUT-800)', () => {
  it.each(['', '   '])(
    'treats %j as no address on create, so the form can leave the field empty',
    async (blank) => {
      const dto = plainToInstance(CreateCustomerDto, {
        ...CREATE_BASE,
        email: blank,
      });

      expect(await validate(dto)).toEqual([]);
      expect(dto.email).toBeNull();
    },
  );

  it('treats a blank address on update as clearing the address', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { email: '' });

    expect(await validate(dto)).toEqual([]);
    expect(dto.email).toBeNull();
  });

  it('trims a real address and still refuses text that is not an address', async () => {
    const trimmed = plainToInstance(CreateCustomerDto, {
      ...CREATE_BASE,
      email: '  max@example.com ',
    });
    expect(await validate(trimmed)).toEqual([]);
    expect(trimmed.email).toBe('max@example.com');

    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        email: 'not-an-address',
      }),
    ).toEqual(['email']);
    expect(
      await failingProperties(UpdateCustomerDto, { email: 'a b@c' }),
    ).toEqual(['email']);
  });

  it('leaves a missing address alone on both DTOs', async () => {
    expect(
      await validate(plainToInstance(CreateCustomerDto, CREATE_BASE)),
    ).toEqual([]);
    const update = plainToInstance(UpdateCustomerDto, { phone: '123' });
    expect(await validate(update)).toEqual([]);
    expect(update.email).toBeUndefined();
  });
});
