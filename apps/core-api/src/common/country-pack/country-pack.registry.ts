export type CountryIso = 'AT' | 'DE';

export type CountryCapabilities = Readonly<{
  nova: boolean;
  pickerl57a: boolean;
  kaufvertragAt: boolean;
  willhabenExport: boolean;
}>;

export type CountryPack = Readonly<{
  countryIso: CountryIso;
  capabilities: CountryCapabilities;
  defaultVatRate: number;
  marginSchemeNoteKey: CountryIso;
  validateVatId: (value: string) => boolean;
  validateTaxNumber: (value: string) => boolean;
  defaultAccountingProfile: string;
  locale: string;
  timeZone: string;
  sellerTaxIdentifier: 'vat_id' | 'tax_number_or_vat_id';
  vatIdLabelKey: 'invoice.uidLabel' | 'invoice.vatIdLabel';
  vatIdLabel: 'UID' | 'USt-IdNr.';
}>;

const countryPacks = {
  AT: Object.freeze({
    countryIso: 'AT',
    capabilities: Object.freeze({
      nova: true,
      pickerl57a: true,
      kaufvertragAt: true,
      willhabenExport: true,
    }),
    defaultVatRate: 20,
    marginSchemeNoteKey: 'AT',
    validateVatId: (value: string) =>
      /^ATU[0-9]{8}$/.test(value.replace(/\s+/g, '').toUpperCase()),
    validateTaxNumber: (value: string) =>
      /^[0-9]{2}\/?[0-9]{3}\/?[0-9]{4}$/.test(value.replace(/\s+/g, '')),
    defaultAccountingProfile: 'ACP-RZL-AT-EUR-1',
    locale: 'de-AT',
    timeZone: 'Europe/Vienna',
    sellerTaxIdentifier: 'vat_id',
    vatIdLabelKey: 'invoice.uidLabel',
    vatIdLabel: 'UID',
  }),
  DE: Object.freeze({
    countryIso: 'DE',
    capabilities: Object.freeze({
      nova: false,
      pickerl57a: false,
      kaufvertragAt: false,
      willhabenExport: false,
    }),
    defaultVatRate: 19,
    marginSchemeNoteKey: 'DE',
    validateVatId: (value: string) =>
      /^DE[0-9]{9}$/.test(value.replace(/\s+/g, '').toUpperCase()),
    validateTaxNumber: (value: string) =>
      /^[0-9]{9,13}$/.test(value.replace(/[\s/]+/g, '')),
    defaultAccountingProfile: 'ACP-DATEV-DE-EUR-1',
    locale: 'de-DE',
    timeZone: 'Europe/Berlin',
    sellerTaxIdentifier: 'tax_number_or_vat_id',
    vatIdLabelKey: 'invoice.vatIdLabel',
    vatIdLabel: 'USt-IdNr.',
  }),
} as const satisfies Record<CountryIso, CountryPack>;

const packsByCountry = new Map<string, CountryPack>(
  Object.entries(countryPacks),
);

export class UnsupportedCountryError extends Error {
  constructor(readonly countryIso: string | null | undefined) {
    super(`Unsupported country: ${countryIso ?? '(missing)'}`);
    this.name = 'UnsupportedCountryError';
  }
}

export function findCountryPack(
  countryIso: string | null | undefined,
): CountryPack | undefined {
  return countryIso == null ? undefined : packsByCountry.get(countryIso);
}

export function resolveCountryPack(
  countryIso: string | null | undefined,
): CountryPack {
  const pack = findCountryPack(countryIso);
  if (!pack) {
    throw new UnsupportedCountryError(countryIso);
  }
  return pack;
}
