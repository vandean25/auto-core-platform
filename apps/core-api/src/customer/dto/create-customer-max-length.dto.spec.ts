import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto.js';
import { UpdateCustomerDto } from './update-customer.dto.js';

/** Field and character limit of every capped column on the customer DTOs (AUT-732). */
const CAPS: ReadonlyArray<readonly [field: string, limit: number]> = [
  ['company_name', 200],
  ['first_name', 120],
  ['last_name', 120],
  ['email', 254],
  ['phone', 40],
  ['vat_id', 32],
  ['address_street', 200],
  ['address_city', 120],
  ['address_zip', 20],
  ['address_country', 100],
];

const CREATE_BASE = { first_name: 'Max', last_name: 'Muster' };

/** A syntactically valid e-mail of exactly `length` characters (the e-mail rule itself also caps at 254). */
function emailAtLength(length: number): string {
  const tail = 'example.test';
  const labelBlock = `${'l'.repeat(60)}.`;
  const room = length - 1 - tail.length;
  const labels = Math.floor((room - 1) / labelBlock.length);
  return `${'a'.repeat(room - labels * labelBlock.length)}@${labelBlock.repeat(labels)}${tail}`;
}

function valueAtLength(field: string, length: number): string {
  return field === 'email' ? emailAtLength(length) : 'x'.repeat(length);
}

async function failingProperties(
  dto: new () => object,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));
  return errors.map((error) => error.property);
}

describe('max length on the customer DTOs (AUT-732)', () => {
  it.each(CAPS)('accepts %s at its %i character limit', async (field, limit) => {
    expect(
      await failingProperties(UpdateCustomerDto, { [field]: valueAtLength(field, limit) }),
    ).toEqual([]);
  });

  it.each(CAPS)('refuses %s one character over its limit', async (field, limit) => {
    expect(
      await failingProperties(UpdateCustomerDto, { [field]: valueAtLength(field, limit + 1) }),
    ).toEqual([field]);
  });

  it.each(CAPS)('refuses an over-long %s on create as well', async (field, limit) => {
    expect(
      await failingProperties(CreateCustomerDto, {
        ...CREATE_BASE,
        [field]: valueAtLength(field, limit + 1),
      }),
    ).toContain(field);
  });

  it('keeps the required names working on create', async () => {
    expect(await failingProperties(CreateCustomerDto, CREATE_BASE)).toEqual([]);
    expect(await failingProperties(CreateCustomerDto, { first_name: 'Max' })).toEqual([
      'last_name',
    ]);
  });

  it('checks the e-mail helper itself, so a wrong length would not pass silently', () => {
    expect(emailAtLength(254)).toHaveLength(254);
    expect(emailAtLength(255)).toHaveLength(255);
  });
});
