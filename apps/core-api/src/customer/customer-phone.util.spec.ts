import { normalizePhone, withPhoneDigits } from './customer-phone.util.js';

/** Mirrors the AUT-698 migration SQL backfill on digit-only input. */
function normalizePhoneMigrationSql(digits: string | null): string | null {
  if (!digits) {
    return null;
  }
  if (digits.startsWith('0043')) {
    return `0${digits.slice(4)}`;
  }
  if (digits.startsWith('43') && digits.length > 2) {
    return `0${digits.slice(2)}`;
  }
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  return digits;
}

function digitsOnly(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

describe('normalizePhone', () => {
  it.each([
    ['+43 664 1234567', '06641234567'],
    ['0043 664 1234567', '06641234567'],
    ['0664/1234567', '06641234567'],
    ['0664-123 45 67', '06641234567'],
    ['06641234567', '06641234567'],
    ['+49 170 1234567', '491701234567'],
    ['0049 170 1234567', '491701234567'],
    ['0170 1234567', '01701234567'],
  ])('normalises %p to %p', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['+43 664 1234567'],
    ['0664/1234567'],
    ['+49 170 1234567'],
  ])('matches the migration SQL backfill for %p', (input) => {
    const rawDigits = digitsOnly(input);
    expect(normalizePhone(input)).toBe(normalizePhoneMigrationSql(rawDigits));
  });

  it.each([[null], [undefined], [''], ['   '], ['abc']])(
    'returns null for empty input %p',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('withPhoneDigits', () => {
  it('derives phone_digits when the phone is written', () => {
    expect(
      withPhoneDigits({ phone: '+43 664 1234567', first_name: 'x' }),
    ).toEqual({
      phone: '+43 664 1234567',
      first_name: 'x',
      phone_digits: '06641234567',
    });
  });

  it('clears phone_digits when the phone is cleared', () => {
    expect(withPhoneDigits({ phone: null })).toEqual({
      phone: null,
      phone_digits: null,
    });
  });

  it('understands the Prisma set form of an update', () => {
    expect(
      withPhoneDigits({ phone: { set: '+43 664 1234567' } }).phone_digits,
    ).toBe('06641234567');
  });

  it('leaves data untouched when the phone is not written', () => {
    const data: { first_name: string; phone?: string } = { first_name: 'x' };
    expect(withPhoneDigits(data)).toBe(data);
    expect(withPhoneDigits({ phone: undefined })).not.toHaveProperty(
      'phone_digits',
    );
  });
});
