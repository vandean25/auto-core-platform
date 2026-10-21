import type { CanonicalInspectionResult } from './inspection-exchange.types.js';

/** Synthetic canonical results for TEST_ONLY profile (no real EBV wire format). */
export const SYNTHETIC_CANONICAL_POSITIVE: CanonicalInspectionResult = {
  schema_version: 'acp-inspection-result/1',
  source_schema_version: 'TEST_ONLY/1',
  source_system: 'EBV',
  source_account_ref: 'SYNTH-ACCOUNT-001',
  source_station_id: 'SYNTH-STATION-001',
  source_result_id: 'SYNTH-RESULT-001',
  source_revision: 'SYNTH-REV-1',
  zbd_report_id: 'SYNTH-ZBD-001',
  occurrence_relation: {
    kind: 'INITIAL',
    predecessor: null,
    classification_evidence_ref: 'SYNTH-DISTINCT-INSPECTION-001',
  },
  vehicle: {
    vin: 'WVWZZZ1JZXW000001',
    first_registration_on: '2020-10-01',
    registration_plate: 'SYNTH-001',
  },
  inspected_at: '2026-10-15T23:30:00+02:00',
  inspector: {
    source_person_id: 'SYNTH-PERSON-001',
    qualification_evidence_ref: null,
  },
  outcome: 'POSITIVE',
  native_outcome_code: 'SYNTH-POSITIVE',
  plate: {
    number: 'SYNTH-PLATE-001',
    colour: 'SYNTH-COLOUR',
    valid_until: '2027-10',
  },
  odometer: { value: '12345.000', unit: 'km' },
  finality: 'FINAL',
  acknowledgement: {
    state: 'CONFIRMED',
    evidence_type: 'TEST_ONLY_FINAL_RECEIPT',
    evidence_ref: 'SYNTH-RECEIPT-001',
  },
};

export const SYNTHETIC_CANONICAL_POSITIVE_NO_PLATE: CanonicalInspectionResult =
  {
    ...SYNTHETIC_CANONICAL_POSITIVE,
    source_result_id: 'SYNTH-RESULT-NO-PLATE',
    source_revision: 'SYNTH-REV-NO-PLATE',
    zbd_report_id: 'SYNTH-ZBD-NO-PLATE',
    plate: null,
    occurrence_relation: {
      ...SYNTHETIC_CANONICAL_POSITIVE.occurrence_relation,
      classification_evidence_ref: 'SYNTH-DISTINCT-NO-PLATE',
    },
  };

export const SYNTHETIC_CANONICAL_UNKNOWN_OUTCOME: CanonicalInspectionResult = {
  ...SYNTHETIC_CANONICAL_POSITIVE,
  source_result_id: 'SYNTH-RESULT-UNKNOWN',
  source_revision: 'SYNTH-REV-UNKNOWN',
  zbd_report_id: 'SYNTH-ZBD-UNKNOWN',
  outcome: 'UNKNOWN',
  native_outcome_code: 'SYNTH-UNKNOWN',
  occurrence_relation: {
    ...SYNTHETIC_CANONICAL_POSITIVE.occurrence_relation,
    classification_evidence_ref: 'SYNTH-DISTINCT-UNKNOWN',
  },
};

export const SYNTHETIC_CANONICAL_NEGATIVE: CanonicalInspectionResult = {
  ...SYNTHETIC_CANONICAL_POSITIVE,
  source_result_id: 'SYNTH-RESULT-NEGATIVE',
  source_revision: 'SYNTH-REV-NEGATIVE',
  zbd_report_id: 'SYNTH-ZBD-NEGATIVE',
  outcome: 'NEGATIVE',
  native_outcome_code: 'SYNTH-NEGATIVE',
  plate: null,
  occurrence_relation: {
    ...SYNTHETIC_CANONICAL_POSITIVE.occurrence_relation,
    classification_evidence_ref: 'SYNTH-DISTINCT-NEGATIVE',
  },
};

const RECORDED_BY_REFERENCE: Record<string, CanonicalInspectionResult> = {
  'SYNTH-RESULT-001': SYNTHETIC_CANONICAL_POSITIVE,
  'SYNTH-RESULT-NO-PLATE': SYNTHETIC_CANONICAL_POSITIVE_NO_PLATE,
  'SYNTH-RESULT-UNKNOWN': SYNTHETIC_CANONICAL_UNKNOWN_OUTCOME,
  'SYNTH-RESULT-NEGATIVE': SYNTHETIC_CANONICAL_NEGATIVE,
};

export function lookupSyntheticCanonicalResult(
  nativeResultReference: string,
): CanonicalInspectionResult | null {
  return RECORDED_BY_REFERENCE[nativeResultReference] ?? null;
}

export function registerSyntheticCanonicalResult(
  nativeResultReference: string,
  result: CanonicalInspectionResult,
): void {
  RECORDED_BY_REFERENCE[nativeResultReference] = result;
}
