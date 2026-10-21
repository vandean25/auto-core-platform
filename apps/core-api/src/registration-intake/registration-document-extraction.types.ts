export const REGISTRATION_DOCUMENT_PROMPT_VERSION = 'registration-document-v1';

export type RegistrationDocumentKind =
  'AT_ZULASSUNGSSCHEIN' | 'DE_ZB_I' | 'OTHER' | 'UNKNOWN';

export type RegistrationProviderWarning =
  'WRONG_DOCUMENT' | 'ILLEGIBLE' | 'EXTRA_PAGES_IGNORED' | 'BACK_NOT_SUPPLIED';

export interface RegistrationFieldEvidence {
  raw: string | null;
  normalized: string | number | { firstName: string; lastName: string } | null;
  source: {
    page: number;
    region: { x: number; y: number; width: number; height: number };
  } | null;
  uncertainty: number | null;
  absence?: 'CONFIDENT';
  cycle?: 'WLTP' | 'NEDC' | null;
  alternate?: RegistrationFieldEvidence;
}

export interface RegistrationMatchSnapshot {
  customers: { id: string; firstName: string; lastName: string }[];
  vehicles: {
    id: string;
    vin: string | null;
    plate: string | null;
    customerId: string | null;
  }[];
  cases: string[];
}
