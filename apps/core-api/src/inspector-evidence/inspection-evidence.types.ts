export const INSPECTOR_EVIDENCE_SCHEMA_VERSION = 'acp-inspector-evidence/1';

export type InspectorEvidenceReviewState =
  'UNREVIEWED' | 'EVIDENCE_REVIEWED' | 'SOURCE_CONFLICT';

export type EvidenceTemporalScope =
  | 'CURRENT'
  | 'CONTINUATION'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'OUT_OF_SCOPE'
  | 'REVOKED'
  | 'UNKNOWN';

export type EvidenceFreshness = 'CURRENT' | 'STALE';

export type QualificationSupportStatus =
  'QUALIFICATION_UNKNOWN' | 'QUALIFICATION_EXPIRED' | 'QUALIFICATION_CURRENT';

export type InspectorEvidencePayload = {
  schema_version: string;
  source_version: string;
  issuer: string;
  source_person_ref: string;
  station_ref: string;
  assignment_ref: string;
  assignment_from: string | null;
  assignment_until_exclusive: string | null;
  vehicle_classes: string[];
  weight_scope: string | null;
  brake_course_scope: string | null;
  training_completed_on: string | null;
  next_training_due_on: string | null;
  continuation_from: string | null;
  continuation_until_exclusive: string | null;
  effective_from: string | null;
  effective_until_exclusive: string | null;
  withdrawal_effective_at: string | null;
  document_ref: string;
  provenance: string;
};

export type EvidenceAssessmentRequest = {
  station_ref: string;
  vehicle_class: string | null;
  inspection_time: Date;
  as_of: Date;
  identity_conflict?: boolean;
};

export type EvidenceAssessmentResult = {
  evidence_review: InspectorEvidenceReviewState;
  inspection_time_temporal_scope: EvidenceTemporalScope;
  as_of_temporal_scope: EvidenceTemporalScope;
  freshness: EvidenceFreshness;
  qualification_support_status: QualificationSupportStatus;
  registry_adapter: 'NOT_CONFIGURED';
};

export type StoredEvidenceRevision = InspectorEvidencePayload & {
  id: string;
  predecessor_revision_id: string | null;
  created_at: Date;
  evidence_review: InspectorEvidenceReviewState;
  document_digest: string;
  reviewed_at: Date | null;
  review_valid_until: Date | null;
};
