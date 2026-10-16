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

const RECORDED_BY_REFERENCE: Record<string, CanonicalInspectionResult> = {
  'SYNTH-RESULT-001': SYNTHETIC_CANONICAL_POSITIVE,
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

export function resetSyntheticCanonicalRegistry(): void {
  for (const key of Object.keys(RECORDED_BY_REFERENCE)) {
    if (key !== 'SYNTH-RESULT-001') {
      delete RECORDED_BY_REFERENCE[key];
    }
  }
  RECORDED_BY_REFERENCE['SYNTH-RESULT-001'] = SYNTHETIC_CANONICAL_POSITIVE;
}
