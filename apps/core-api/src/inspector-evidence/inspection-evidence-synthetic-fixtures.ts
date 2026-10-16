import type { InspectorEvidencePayload } from './inspection-evidence.types.js';
import { INSPECTOR_EVIDENCE_SCHEMA_VERSION } from './inspection-evidence.types.js';

export const SYNTHETIC_INSPECTOR_EVIDENCE_DOCUMENT_REF =
  'SYNTH-RESTRICTED-DOCUMENT-1';

export const SYNTHETIC_STATION_REF = 'SYNTH-STATION-1';

export const SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD: InspectorEvidencePayload = {
  schema_version: INSPECTOR_EVIDENCE_SCHEMA_VERSION,
  source_version: 'SYNTH-DOC-1',
  issuer: 'SYNTH-AUTHORITY',
  source_person_ref: 'SYNTH-PERSON-1',
  station_ref: SYNTHETIC_STATION_REF,
  assignment_ref: 'SYNTH-ASSIGNMENT-1',
  assignment_from: '2026-01-01',
  assignment_until_exclusive: '2027-01-01',
  vehicle_classes: ['M1'],
  weight_scope: 'SYNTH-UP-TO-3500-KG',
  brake_course_scope: null,
  training_completed_on: '2024-01-10',
  next_training_due_on: '2027-01-10',
  continuation_from: null,
  continuation_until_exclusive: null,
  effective_from: '2026-01-01',
  effective_until_exclusive: '2027-01-01',
  withdrawal_effective_at: null,
  document_ref: SYNTHETIC_INSPECTOR_EVIDENCE_DOCUMENT_REF,
  provenance: 'TEST_ONLY_DOCUMENT_REVIEW_NOT_REGISTRY_LOOKUP',
};
