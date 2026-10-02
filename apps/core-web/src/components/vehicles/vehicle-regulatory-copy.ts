export type BilingualCopy = { en: string; de: string };

export const VEHICLE_REGULATORY_SECTION: BilingualCopy = {
  en: 'Registration & emissions',
  de: 'Zulassung & Emissionen',
};

export const VEHICLE_REGULATORY_FIELDS = {
  firstRegistrationDate: {
    en: 'First registration date',
    de: 'Erstzulassung',
  },
  co2Wltp: {
    en: 'CO₂ WLTP (g/km)',
    de: 'CO₂ WLTP (g/km)',
  },
  co2Nedc: {
    en: 'CO₂ NEDC (g/km)',
    de: 'CO₂ NEDC (g/km)',
  },
  typenscheinNo: {
    en: 'Type approval no. (Typenschein)',
    de: 'Typenschein-Nr.',
  },
  novaClass: {
    en: 'NoVA class',
    de: 'NoVA-Klasse',
  },
  emissionClass: {
    en: 'Emission class',
    de: 'Schadstoffklasse',
  },
  registrationCertificate: {
    en: 'Registration certificate (ZB I)',
    de: 'Zulassungsbescheinigung Teil I (ZB I)',
  },
} satisfies Record<string, BilingualCopy>;

export const REGISTRATION_CERTIFICATE_HELP: BilingualCopy = {
  en:
    'ZB I (Fahrzeugschein) is the vehicle registration document. The Typenschein is the type-approval certificate — use the Typenschein field for its number.',
  de:
    'ZB I (Fahrzeugschein) ist die Zulassungsbescheinigung Teil I. Der Typenschein ist das Typgenehmigungsdokument — dessen Nummer tragen Sie im Feld Typenschein ein.',
};

export function bilingualLabel(copy: BilingualCopy): string {
  return `${copy.en} / ${copy.de}`;
}

export const VEHICLE_NOVA_CLASS_OPTIONS = [
  { value: 'NOT_SET', label: bilingualLabel({ en: 'Not set', de: 'Nicht gesetzt' }) },
  { value: 'STANDARD', label: bilingualLabel({ en: 'Standard', de: 'Standard' }) },
  {
    value: 'ELECTRIC_EXEMPT',
    label: bilingualLabel({ en: 'Electric exempt', de: 'Elektro befreit' }),
  },
  { value: 'OTHER', label: bilingualLabel({ en: 'Other', de: 'Sonstige' }) },
] as const;
