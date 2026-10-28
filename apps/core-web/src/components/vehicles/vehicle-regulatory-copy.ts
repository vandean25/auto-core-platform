import { useTranslation } from 'react-i18next';

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

export function localizedCopy(copy: BilingualCopy, language: string): string {
  return language.startsWith('de') ? copy.de : copy.en;
}

export function useLocalizedCopy(): (copy: BilingualCopy) => string {
  const { i18n } = useTranslation();
  return (copy) => localizedCopy(copy, i18n.language);
}

export const VEHICLE_SELECT_PLACEHOLDER: BilingualCopy = { en: 'Select', de: 'Auswählen' };

export const VEHICLE_NOVA_CLASS_OPTIONS = [
  { value: 'NOT_SET', copy: { en: 'Not set', de: 'Nicht gesetzt' } },
  { value: 'STANDARD', copy: { en: 'Standard', de: 'Standard' } },
  { value: 'ELECTRIC_EXEMPT', copy: { en: 'Electric exempt', de: 'Elektro befreit' } },
  { value: 'OTHER', copy: { en: 'Other', de: 'Sonstige' } },
] as const satisfies readonly { value: string; copy: BilingualCopy }[];
