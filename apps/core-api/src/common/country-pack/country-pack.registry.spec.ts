import {
  findCountryPack,
  resolveCountryPack,
  UnsupportedCountryError,
} from './country-pack.registry.js';

const expectedPacks = [
  {
    countryIso: 'AT',
    capabilities: {
      nova: true,
      pickerl57a: true,
      kaufvertragAt: true,
      willhabenExport: true,
    },
    defaultVatRate: 20,
    marginSchemeNoteKey: 'AT',
    defaultAccountingProfile: 'ACP-RZL-AT-EUR-1',
    locale: 'de-AT',
    timeZone: 'Europe/Vienna',
    sellerTaxIdentifier: 'vat_id',
    vatIdLabelKey: 'invoice.uidLabel',
    vatIdLabel: 'UID',
    validVatId: ' atu12345678 ',
    invalidVatId: 'DE123456789',
    validTaxNumber: '12/345/6789',
    invalidTaxNumber: '123',
  },
  {
    countryIso: 'DE',
    capabilities: {
      nova: false,
      pickerl57a: false,
      kaufvertragAt: false,
      willhabenExport: false,
    },
    defaultVatRate: 19,
    marginSchemeNoteKey: 'DE',
    defaultAccountingProfile: 'ACP-DATEV-DE-EUR-1',
    locale: 'de-DE',
    timeZone: 'Europe/Berlin',
    sellerTaxIdentifier: 'tax_number_or_vat_id',
    vatIdLabelKey: 'invoice.vatIdLabel',
    vatIdLabel: 'USt-IdNr.',
    validVatId: ' de123456789 ',
    invalidVatId: 'ATU12345678',
    validTaxNumber: '123/456/789',
    invalidTaxNumber: '123',
  },
] as const;

describe('country packs', () => {
  it.each(expectedPacks)(
    'defines every capability and default for $countryIso',
    (expected) => {
      const {
        validVatId,
        invalidVatId,
        validTaxNumber,
        invalidTaxNumber,
        ...defaults
      } = expected;
      const { validateVatId, validateTaxNumber, ...pack } = resolveCountryPack(
        expected.countryIso,
      );
      expect(pack).toEqual(defaults);
      expect(validateVatId(validVatId)).toBe(true);
      expect(validateVatId(invalidVatId)).toBe(false);
      expect(validateTaxNumber(validTaxNumber)).toBe(true);
      expect(validateTaxNumber(invalidTaxNumber)).toBe(false);
    },
  );

  it.each([
    'FR',
    '',
    'at',
    'Austria',
    '__proto__',
    'constructor',
    null,
    undefined,
  ])('never silently resolves %s to Austria', (country) => {
    expect(() => resolveCountryPack(country)).toThrow(UnsupportedCountryError);
    expect(findCountryPack(country)).toBeUndefined();
  });

  it.each(['AT', 'DE'])('returns the registered entry for %s', (country) => {
    expect(findCountryPack(country)).toBe(resolveCountryPack(country));
  });

  it('does not allow one consumer to mutate capability flags for later sessions', () => {
    expect(Object.isFrozen(resolveCountryPack('AT').capabilities)).toBe(true);
    expect(Object.isFrozen(resolveCountryPack('AT'))).toBe(true);
  });
});
