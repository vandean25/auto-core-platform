export const ACP_INSPECTION_RESULT_SCHEMA = 'acp-inspection-result/1';

export type CanonicalInspectionOutcome =
  'POSITIVE' | 'NEGATIVE' | 'REVOKED' | 'UNKNOWN';

export type CanonicalOccurrenceKind =
  'INITIAL' | 'CORRECTION' | 'REVOCATION' | 'UNKNOWN';

export type CanonicalInspectionResult = {
  schema_version: string;
  source_schema_version: string;
  source_system: 'EBV';
  source_account_ref: string;
  source_station_id: string;
  source_result_id: string;
  source_revision: string;
  zbd_report_id: string | null;
  occurrence_relation: {
    kind: CanonicalOccurrenceKind;
    predecessor: Record<string, string> | null;
    classification_evidence_ref: string | null;
  };
  vehicle: {
    vin: string;
    first_registration_on: string;
    registration_plate?: string | null;
  };
  inspected_at: string;
  inspector: {
    source_person_id: string;
    qualification_evidence_ref?: string | null;
  };
  outcome: CanonicalInspectionOutcome;
  native_outcome_code?: string | null;
  plate: {
    number: string;
    colour: string;
    valid_until: string;
  } | null;
  odometer?: { value: string; unit: string } | null;
  finality: 'FINAL' | 'DRAFT' | 'UNKNOWN';
  acknowledgement: {
    state: 'CONFIRMED' | 'UNCONFIRMED' | 'UNKNOWN';
    evidence_type?: string | null;
    evidence_ref?: string | null;
  };
};

export type EbvFetchStatus =
  'RESULT' | 'NOT_FOUND' | 'ERROR' | 'NOT_CONFIGURED' | 'TIMEOUT';

export type EbvFetchEnvelope = {
  status: EbvFetchStatus;
  canonical?: CanonicalInspectionResult;
  originalUtf8?: string;
  trustedReceipt?: boolean;
};

export type InspectionConnectionContext = {
  profileId: string;
  sourceAccountRef: string;
  sourceStationId: string;
  bindingRevision: number;
};
