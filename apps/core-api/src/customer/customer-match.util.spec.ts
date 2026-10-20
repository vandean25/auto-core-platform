import {
  buildDisplayNameInitials,
  buildNameVariants,
  buildPhoneVariants,
  foldMatchName,
  maskMatchEmail,
  maskMatchPhone,
  normalizeMatchEmail,
  normalizeMatchPhone,
  normalizeMatchVatId,
  normalizeMatchZip,
} from './customer-match.util.js';

describe('customer match normalization (AUT-613)', () => {
  it('matches e-mail addresses case-insensitively', () => {
    expect(normalizeMatchEmail(' Max.Mustermann@Example.AT ')).toBe(
      'max.mustermann@example.at',
    );
    expect(normalizeMatchEmail(null)).toBeNull();
    expect(normalizeMatchEmail('   ')).toBeNull();
  });

  it('matches phone numbers by national digits', () => {
    expect(normalizeMatchPhone('+43 664 123456')).toBe('664123456');
    expect(normalizeMatchPhone('0043 664 123456')).toBe('664123456');
    expect(normalizeMatchPhone('0664 123456')).toBe('664123456');
    expect(normalizeMatchPhone('664123456')).toBe('664123456');
    expect(normalizeMatchPhone('')).toBeNull();
  });

  it('matches the UID upper case and without spaces', () => {
    expect(normalizeMatchVatId(' at u 12345678 ')).toBe('ATU12345678');
    expect(normalizeMatchVatId(undefined)).toBeNull();
  });

  it('folds names case- and umlaut-insensitively', () => {
    expect(foldMatchName('Müller')).toBe('mueller');
    expect(foldMatchName('MUELLER')).toBe('mueller');
    expect(foldMatchName('Mueller')).toBe('mueller');
    expect(foldMatchName('Müller')).toBe('mueller');
    expect(foldMatchName('  Max   Mustermann ')).toBe('max mustermann');
  });

  it('keeps the spellings a folded name may be stored under', () => {
    const variants = buildNameVariants('Mueller');
    expect(variants).toContain('Mueller');
    expect(variants).toContain('Müller');
  });

  it('keeps the spellings a phone number may be stored under', () => {
    const variants = buildPhoneVariants('+43 664 123456');
    expect(variants).toEqual(
      expect.arrayContaining(['+43664123456', '0664123456', '664123456']),
    );
  });

  it('normalizes the postcode for comparison', () => {
    expect(normalizeMatchZip(' 1010 ')).toBe('1010');
    expect(normalizeMatchZip('1010 Wien')).toBe('1010WIEN');
    expect(normalizeMatchZip(undefined)).toBeNull();
  });

  it('masks the e-mail and keeps the last three phone digits', () => {
    expect(maskMatchEmail('max@example.at')).toBe('m***@example.at');
    expect(maskMatchPhone('+43 664 123456')).toContain('456');
    expect(maskMatchPhone('+43 664 123456')).not.toContain('664');
  });

  it('builds display name initials without the full name', () => {
    expect(buildDisplayNameInitials({ first_name: 'Max', last_name: 'Mustermann' })).toBe(
      'MM',
    );
    expect(
      buildDisplayNameInitials({ company_name: 'Musterwerkstatt Nord' }),
    ).toBe('MN');
    expect(buildDisplayNameInitials({})).toBe('');
  });
});
