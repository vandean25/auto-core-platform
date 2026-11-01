import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto.js';
import { UpdateCustomerDto } from './update-customer.dto.js';

const CREATE_BASE = { first_name: 'Max', last_name: 'Muster' };

async function failingProperties(
  dto: new () => object,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));
  return errors.map((error) => error.property);
}

describe('max length on the customer DTOs (AUT-732)', () => {
  it('refuses a first_name longer than 120 characters on create', async () => {
    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        first_name: 'A'.repeat(121),
      }),
    ).toEqual(['first_name']);
  });

  it('accepts a first_name at the 120 character limit and normal values on create', async () => {
    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        first_name: 'A'.repeat(120),
        company_name: 'Acme GmbH',
        phone: '+43 660 1234567',
        vat_id: 'ATU12345678',
        address_street: 'Hauptstrasse 1',
        address_city: 'Wien',
        address_zip: '1010',
        address_country: 'Austria',
      }),
    ).toEqual([]);
  });

  it('refuses a too-long last_name on create and company_name/phone on update', async () => {
    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        last_name: 'B'.repeat(121),
      }),
    ).toEqual(['last_name']);
    expect(
      await failingProperties(UpdateCustomerDto, { company_name: 'C'.repeat(201) }),
    ).toEqual(['company_name']);
    expect(await failingProperties(UpdateCustomerDto, { phone: '9'.repeat(41) })).toEqual(
      ['phone'],
    );
  });

  it('inherits the max length rules on update via PartialType', async () => {
    expect(
      await failingProperties(UpdateCustomerDto, { first_name: 'A'.repeat(121) }),
    ).toEqual(['first_name']);
    expect(
      await failingProperties(UpdateCustomerDto, { first_name: 'A'.repeat(120) }),
    ).toEqual([]);
  });

  it('refuses an address field longer than its cap', async () => {
    expect(
      await failingProperties(UpdateCustomerDto, { address_zip: '1'.repeat(21) }),
    ).toEqual(['address_zip']);
    expect(
      await failingProperties(UpdateCustomerDto, { address_city: 'W'.repeat(121) }),
    ).toEqual(['address_city']);
  });
});
